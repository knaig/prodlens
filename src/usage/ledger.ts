// Spec: v2 §12.2 - see spec/traceability.md
// Cost ledger (SaaS metering): the lazy-dist pattern ported to prodlens.
// Flat per-unit cost ESTIMATES (labeled as estimates - precise enough for cap
// enforcement, not a billing-grade token meter), idempotent recordCost via
// refId, per-project monthly caps with a preflight gate, file-backed
// (data/usage/events-YYYY-MM.jsonl) so it works with zero infrastructure and
// maps 1:1 onto a DB table in the hosted control plane.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type CostBucket = "llm" | "vision_llm" | "tts" | "crawl" | "execute" | "render" | "storage";

export interface CostEvent {
  at: string;
  projectId: string;
  bucket: CostBucket;
  refId: string;
  units: number;
  unitName: string;
  costUsdMicros: number;
  note?: string;
}

/** Flat unit estimates (USD micros). Blended provider prices, 2026-08. */
export const UNIT_COST: Record<CostBucket, { micros: number; unitName: string }> = {
  llm: { micros: 2_000, unitName: "call" },          // $0.002/call - small OpenRouter model, blended
  vision_llm: { micros: 4_000, unitName: "image" },  // $0.004/screenshot judged
  tts: { micros: 20_000, unitName: "clip" },         // $0.02/narration clip - Gemini TTS
  crawl: { micros: 1_500, unitName: "page" },        // $0.0015/page - browser compute
  execute: { micros: 3_000, unitName: "journey-step" },
  render: { micros: 60_000, unitName: "video-minute" }, // $0.06/min - browser + ffmpeg compute
  storage: { micros: 300, unitName: "MB-month" },
};

export const DEFAULT_MONTHLY_CAP_USD = 25;

const dataRoot = () => resolve(process.cwd(), "data");
const usageDir = () => join(dataRoot(), "usage");
const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
const eventsPath = (month: string) => join(usageDir(), `events-${month}.jsonl`);
const budgetsPath = () => join(usageDir(), "budgets.json");

// Current spend context: stage jobs run single-flight (jobs.ts), so a module
// global is safe; hooks deep in llm/tts code read it without plumbing.
let currentProjectId = "unattributed";
export function setUsageContext(projectId: string): void {
  currentProjectId = projectId;
}
export function usageContext(): string {
  return currentProjectId;
}

const seenRefIds = new Set<string>();

function loadSeen(month: string): void {
  const p = eventsPath(month);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    try { seenRefIds.add((JSON.parse(line) as CostEvent).refId); } catch { /* skip */ }
  }
}
let seenLoadedFor = "";

/** Idempotent: a refId that was already recorded this month is a no-op
 *  (protects against retried stages double-billing). */
export function recordCost(bucket: CostBucket, refId: string, units = 1, opts: { projectId?: string; note?: string } = {}): void {
  const month = monthKey();
  if (seenLoadedFor !== month) { seenRefIds.clear(); loadSeen(month); seenLoadedFor = month; }
  const fullRef = `${month}:${refId}`;
  if (seenRefIds.has(fullRef)) return;
  seenRefIds.add(fullRef);
  const ev: CostEvent = {
    at: new Date().toISOString(),
    projectId: opts.projectId ?? currentProjectId,
    bucket,
    refId: fullRef,
    units,
    unitName: UNIT_COST[bucket].unitName,
    costUsdMicros: Math.round(UNIT_COST[bucket].micros * units),
    note: opts.note,
  };
  mkdirSync(usageDir(), { recursive: true });
  appendFileSync(eventsPath(month), JSON.stringify(ev) + "\n");
}

export function listEvents(month = monthKey()): CostEvent[] {
  const p = eventsPath(month);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf-8").split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l) as CostEvent; } catch { return undefined; }
  }).filter((e): e is CostEvent => Boolean(e));
}

export function listMonths(): string[] {
  if (!existsSync(usageDir())) return [];
  return readdirSync(usageDir())
    .map((f) => /^events-(\d{4}-\d{2})\.jsonl$/.exec(f)?.[1])
    .filter((m): m is string => Boolean(m))
    .sort()
    .reverse();
}

export interface UsageSummary {
  month: string;
  totalUsdMicros: number;
  byProject: Record<string, { totalUsdMicros: number; byBucket: Record<string, { units: number; usdMicros: number }> }>;
}

export function summarize(month = monthKey()): UsageSummary {
  const out: UsageSummary = { month, totalUsdMicros: 0, byProject: {} };
  for (const e of listEvents(month)) {
    out.totalUsdMicros += e.costUsdMicros;
    const p = (out.byProject[e.projectId] ??= { totalUsdMicros: 0, byBucket: {} });
    p.totalUsdMicros += e.costUsdMicros;
    const b = (p.byBucket[e.bucket] ??= { units: 0, usdMicros: 0 });
    b.units += e.units;
    b.usdMicros += e.costUsdMicros;
  }
  return out;
}

// ---- budgets + preflight gate ----
export interface Budgets {
  [projectId: string]: { monthlyCapUsd: number };
}

export function getBudgets(): Budgets {
  if (!existsSync(budgetsPath())) return {};
  try { return JSON.parse(readFileSync(budgetsPath(), "utf-8")); } catch { return {}; }
}

export function setBudget(projectId: string, monthlyCapUsd: number): Budgets {
  const all = getBudgets();
  all[projectId] = { monthlyCapUsd };
  mkdirSync(usageDir(), { recursive: true });
  writeFileSync(budgetsPath(), JSON.stringify(all, null, 2));
  return all;
}

export function monthSpendUsd(projectId: string, month = monthKey()): number {
  return (summarize(month).byProject[projectId]?.totalUsdMicros ?? 0) / 1e6;
}

/** Spend gate (lazy-dist preflightBlocked pattern): checked before any stage
 *  that spends. Cap defaults to $25/month per project. */
export function preflightBlocked(projectId: string): { blocked: boolean; spentUsd: number; capUsd: number } {
  const capUsd = getBudgets()[projectId]?.monthlyCapUsd ?? DEFAULT_MONTHLY_CAP_USD;
  const spentUsd = monthSpendUsd(projectId);
  return { blocked: capUsd > 0 && spentUsd >= capUsd, spentUsd, capUsd };
}
