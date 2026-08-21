// Visual QA pass (src/llm/local.ts + a vision-capable LLM like qwen-vl served
// by an OpenAI-compatible endpoint). Each node's already-captured screenshot
// gets one image + one question: is anything VISIBLY broken here? Catches what
// the structural analysis structurally cannot - a screen that renders empty or
// blank, an endless spinner/skeleton, text clipped or spilling off the
// viewport, a button that looks dead. Pure batched inference over existing
// artifacts: no browser, no DOM, no graph changes.
//
// Deliberately scoped to the human eye: prompts explicitly tell the model NOT
// to re-report structural findings (unreachable routes, dead ends, missing
// return paths) - graph/analysis.ts owns those from the DOM.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { localChat, llmVisionModel, llmBaseUrl, type LocalChatResult } from "../llm/local.js";
import type { GraphVersion, Issue } from "../types.js";

export type VisualSeverity = "ok" | "low" | "medium" | "high" | "critical";

export type VisualCategory = "empty-render" | "spinner" | "overflow-layout" | "blank-shell" | "dead-button" | "ok" | "other";

export interface VisualFinding {
  broken: boolean;
  severity: VisualSeverity;
  category: VisualCategory;
  evidence: string;
  suggested_action: string;
}

export interface VisualShotResult {
  nodeId: string;
  title?: string;
  screenshotPath: string;
  finding?: VisualFinding;
  error?: string;
}

export interface VisualReport {
  generatedAt: string;
  model: string;
  total: number;
  flagged: number;
  shots: VisualShotResult[];
}

export interface VisualTriageOptions {
  baseUrl?: string;
  model?: string;
  /** Directory to fall back to for locating per-node screenshots when a node
   *  has no screenshotPath, or when its recorded path no longer exists. */
  screenshotsDir?: string;
  concurrency?: number;
  maxTokens?: number;
}

const SYSTEM_PROMPT =
  "You are a visual QA agent for prodlens. You review one screenshot of a web app screen at a time. " +
  "Flag ONLY what a human eye would call visually broken: a screen that rendered empty or nearly blank (missing content the layout clearly expects), " +
  "an endless loading spinner or skeleton state, text or layout clipped, overlapping, or spilling off the viewport, and buttons/links that render but look dead. " +
  "Do NOT report structural navigation problems (unreachable routes, dead ends, missing return paths) - another pipeline owns those from the DOM. " +
  "A normal, intentional-looking screen is ok. Be conservative: when in doubt, call it ok.";

const CLASSIFY_PROMPT =
  "Classify this screen. Reply with JSON only, no markdown, no code fences: " +
  '{"broken": bool, "severity": "ok"|"low"|"medium"|"high"|"critical", ' +
  '"category": "empty-render"|"spinner"|"overflow-layout"|"blank-shell"|"dead-button"|"ok"|"other", ' +
  '"evidence": "short concrete description of exactly what you see", "suggested_action": "what a developer should verify or fix"}. ' +
  'Set broken=true unless the screen looks like a normally rendered page;\n ' +
  'severity "ok" pairs with broken=false. Keep evidence under 20 words.';

/** Resolve the screenshot file to triage for a node: prefer its recorded
 *  screenshotPath; otherwise reconstruct the crawler's name
 *  (sanitize(nodeId).png) from --screenshots. Misses produce undefined, so a
 *  stale recorded path never fails the pass. */
export function resolveShotPath(nodeId: string, screenshotPath: string | undefined, screenshotsDir: string | undefined): string | undefined {
  if (screenshotPath && existsSync(screenshotPath)) return screenshotPath;
  if (screenshotsDir) {
    const reconstructed = join(screenshotsDir, sanitize(nodeId));
    if (existsSync(reconstructed)) return reconstructed;
  }
  return undefined;
}

function sanitize(p: string): string {
  return p.replace(/[^a-zA-Z0-9]/g, "_") || "root";
}

/** Batch-classify every node's screenshot through the local vision model,
 *  written to dataDir/visual/<id>.json by the caller. Never throws: a down or
 *  unreachable server marks that shot with an error and moves on. */
export async function runVisualTriage(graph: GraphVersion, opts: VisualTriageOptions = {}): Promise<VisualReport> {
  const baseUrl = opts.baseUrl ?? llmBaseUrl();
  const model = opts.model ?? llmVisionModel();
  const concurrency = Math.max(1, opts.concurrency ?? 1);

  const shots = Object.values(graph.nodes)
    .map((node) => {
      const screenshotPath = resolveShotPath(node.id, node.screenshotPath, opts.screenshotsDir);
      return screenshotPath ? { nodeId: node.id, title: node.title, screenshotPath } : undefined;
    })
    .filter((s): s is { nodeId: string; title: string | undefined; screenshotPath: string } => !!s);

  const results: VisualShotResult[] = new Array(shots.length);
  let next = 0;
  const worker = async () => {
    while (next < shots.length) {
      const i = next++;
      const shot = shots[i];
      results[i] = await triageOne(shot, { baseUrl, model, maxTokens: opts.maxTokens });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  return {
    generatedAt: new Date().toISOString(),
    model,
    total: results.length,
    flagged: results.filter((r) => r.finding && (r.finding.broken || r.finding.severity !== "ok")).length,
    shots: results,
  };
}

async function triageOne(
  shot: { nodeId: string; title?: string; screenshotPath: string },
  opts: { baseUrl: string; model: string; maxTokens?: number }
): Promise<VisualShotResult> {
  const attempt = (maxTokens: number) =>
    localChat({
      system: SYSTEM_PROMPT,
      text: CLASSIFY_PROMPT,
      images: [shot.screenshotPath],
      baseUrl: opts.baseUrl,
      model: opts.model,
      maxTokens,
      temperature: 0,
    });

  // Some reasoning models count thinking tokens AGAINST max_tokens - a long
  // think can starve the answer entirely (empty content, finish_reason
  // "length"). Try each budget exactly once, biggest last; after each, if the
  // answer is stuck in the reasoning instead of content, scrape it. max_tokens
  // is a cap, not a target, so the generous ceiling costs nothing unless the
  // model actually rambles into it.
  const budgets = [opts.maxTokens ?? 1024, 4096];
  let res: LocalChatResult | undefined;
  for (const maxTokens of budgets) {
    res = await attempt(maxTokens);
    if (res.content) {
      const finding = parseFinding(res.content);
      if (finding) return result(shot, finding);
      return result(shot, undefined, "unparseable vision response");
    }
    const fromReasoning = res.reasoning ? parseFinding(res.reasoning) : undefined;
    if (fromReasoning) return result(shot, fromReasoning);
    if (res.error && !/ran out of tokens/.test(res.error)) return result(shot, undefined, res.error);
    // budget spent thinking - fall through to the larger budget
  }

  return result(shot, undefined, res?.error ?? "empty response");
}

function result(
  shot: { nodeId: string; title?: string; screenshotPath: string },
  finding: VisualFinding | undefined,
  error?: string
): VisualShotResult {
  return { nodeId: shot.nodeId, title: shot.title, screenshotPath: shot.screenshotPath, ...(finding ? { finding } : {}), ...(error ? { error } : {}) };
}

/** Fold a VisualReport into the pipeline's severity-ranked Issue[] so report
 *  and explore surface visual findings alongside structural ones. The
 *  generatedAt timestamp becomes each evidence entry's timestamp. */
export function visualReportToIssues(report: VisualReport): Issue[] {
  const issues: Issue[] = [];
  for (const shot of report.shots) {
    const finding = shot.finding;
    if (!finding || finding.severity === "ok") continue;
    issues.push({
      id: `visual-${sanitize(shot.nodeId)}`,
      type: "visual",
      severity: finding.severity as Exclude<VisualSeverity, "ok">,
      title: `Screen may render broken (${finding.category.replace("-", " ")}) on ${shot.nodeId}`,
      description: `${finding.evidence} Suggested action: ${finding.suggested_action}`.trim(),
      nodeIds: [shot.nodeId],
      evidence: shot.screenshotPath
        ? [{ type: "screenshot", pathOrValue: shot.screenshotPath, timestamp: report.generatedAt }]
        : undefined,
    });
  }
  return issues;
}

export function parseFinding(content: string): VisualFinding | undefined {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return undefined;
  try {
    const raw = JSON.parse(match[0]) as Partial<VisualFinding>;
    const severity = normalizeSeverity(raw.severity);
    if (!severity) return undefined;
    return {
      broken: severity !== "ok" && raw.broken !== false,
      severity,
      category: normalizeCategory(raw.category),
      evidence: typeof raw.evidence === "string" ? raw.evidence.slice(0, 300) : "",
      suggested_action: typeof raw.suggested_action === "string" ? raw.suggested_action.slice(0, 300) : "",
    };
  } catch {
    return undefined;
  }
}

function normalizeSeverity(v: unknown): VisualSeverity | undefined {
  const s = String(v ?? "").toLowerCase();
  if (s === "ok" || s === "low" || s === "medium" || s === "high" || s === "critical") return s;
  return undefined;
}

function normalizeCategory(v: unknown): VisualFinding["category"] {
  switch (String(v ?? "").toLowerCase()) {
    case "empty-render":
    case "spinner":
    case "overflow-layout":
    case "blank-shell":
    case "dead-button":
    case "ok":
      return String(v).toLowerCase() as VisualFinding["category"];
    default:
      return "other";
  }
}