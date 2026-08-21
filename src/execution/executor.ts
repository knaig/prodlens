// Execution Engine (spec sections 3/5.7, tech spec Stage 5): runs
// PrioritizedPath[] against the live app with bounded-concurrency workers
// (default 4, --concurrency), each with its own browser context/page so
// concurrent paths never share page state. Each PathStep is grounded via
// edgeId into the intended graph's Edge; the step is then run through the
// agent loop (src/agent/loop.ts): deterministic edge resolution first
// (selector / quoted label / href), LLM agent decision when resolution
// genuinely fails, every tool call behind the guard chain, and the whole
// episode appended to the shared run log. The observed graph is derived from
// that log (src/runlog/derive.ts).
import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import { getAuthedContext, type AuthConfig } from "../discovery/auth.js";
import { computeStateSignature } from "../discovery/state-signature.js";
import { RunLog, initRunLog } from "../runlog/store.js";
import type { Edge, GraphVersion, InputScenario, Node, PathRunResult, PrioritizedPath } from "../types.js";
import { runLoopStep, collectCandidates, type Candidate, type LoopOptions, type StepResolution } from "../agent/loop.js";

export interface ExecutionOptions {
  baseUrl: string;
  auth: AuthConfig;
  screenshotDir: string;
  actionTimeoutMs?: number;
  settleMs?: number;
  /** Concurrent path workers, each with its own browser context. Default 4. */
  concurrency?: number;
  /** Default true (and only actually used) when an LLM is configured. */
  agentFallback?: boolean;
  agentModel?: string;
  /** Where the append-only run log is written; resets the file before the run. */
  logPath?: string;
}

export interface ExecutionResult {
  nodes: Record<string, Node>;
  edges: Edge[];
  results: PathRunResult[];
}

export async function runExecution(
  paths: PrioritizedPath[],
  intended: GraphVersion,
  scenarios: InputScenario[],
  opts: ExecutionOptions
): Promise<ExecutionResult> {
  mkdirSync(opts.screenshotDir, { recursive: true });
  if (opts.logPath) initRunLog(opts.logPath);
  const log = new RunLog(opts.logPath ? { path: opts.logPath } : {});
  log.append("run/start", { runId: `run-${Date.now()}`, baseUrl: opts.baseUrl, mode: "run" });

  const edgesById = new Map(intended.edges.map((e) => [e.id, e]));
  const scenariosById = new Map(scenarios.map((s) => [s.id, s]));
  const entryPoint = intended.entryPoints[0];

  const browser = await chromium.launch({ headless: true });
  const nodes: Record<string, Node> = {};
  const edgesOut: Edge[] = [];
  const indexedResults: { index: number; result: PathRunResult }[] = [];
  let edgeCounter = 0;
  const nextEdgeId = () => `actual-${edgeCounter++}`;

  const queue = paths.map((path, index) => ({ path, index }));
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, paths.length || 1));

  try {
    await primeAuth(browser, opts.auth);

    async function worker(): Promise<void> {
      while (queue.length) {
        const item = queue.shift();
        if (!item) return;
        const context = await getAuthedContext(browser, opts.auth);
        const page = await context.newPage();
        try {
          const { result, nodes: pathNodes, edges: pathEdges } = await runSinglePath(
            page,
            item.path,
            edgesById,
            scenariosById,
            opts,
            nextEdgeId,
            entryPoint,
            log
          );
          Object.assign(nodes, pathNodes);
          edgesOut.push(...pathEdges);
          indexedResults.push({ index: item.index, result });
        } finally {
          await context.close();
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, worker));
  } finally {
    log.append("run/end", { reason: "completed" });
    log.close();
    await browser.close();
  }

  const results = indexedResults.sort((a, b) => a.index - b.index).map((r) => r.result);
  return { nodes, edges: edgesOut, results };
}

async function primeAuth(browser: Browser, auth: AuthConfig): Promise<void> {
  if (auth.strategy === "none") return;
  const context = await getAuthedContext(browser, auth);
  await context.close();
}

async function runSinglePath(
  page: Page,
  path: PrioritizedPath,
  edgesById: Map<string, Edge>,
  scenariosById: Map<string, InputScenario>,
  opts: ExecutionOptions,
  nextEdgeId: () => string,
  entryPoint: string,
  log: RunLog
): Promise<{ result: PathRunResult; nodes: Record<string, Node>; edges: Edge[] }> {
  const startedAt = new Date().toISOString();
  const nodes: Record<string, Node> = {};
  const edgesOut: Edge[] = [];
  const agentFallbackEnabled = (opts.agentFallback ?? true) && opts.logPath !== undefined || (opts.agentFallback ?? true);

  const firstEdge = path.steps[0]?.edgeId ? edgesById.get(path.steps[0].edgeId!) : undefined;
  const startNodeId = firstEdge?.from ?? entryPoint;
  await page.goto(`${opts.baseUrl}${startNodeId}`, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
  recordNode(nodes, page, await currentNodeId(page));

  const episodeId = path.id;
  log.append("episode/start", { episodeId, goal: path.goal, entryPath: startNodeId });
  const entryUrl = page.url();
  const entrySignature = computeStateSignature(entryUrl, await page.title().catch(() => ""));
  log.append("state/observed", {
    episodeId,
    nodeId: startNodeId,
    url: entryUrl,
    stateSignature: entrySignature,
    title: await page.title().catch(() => ""),
  });

  const edgesObserved: Edge[] = [];
  const screenshotPaths: string[] = [];
  let stepsCompleted = 0;
  let error: string | undefined;

  const loopOpts: LoopOptions = {
    baseUrl: opts.baseUrl,
    screenshotDir: opts.screenshotDir,
    actionTimeoutMs: opts.actionTimeoutMs ?? 8000,
    settleMs: opts.settleMs ?? 400,
    authed: opts.auth.strategy !== "none",
  };

  for (let stepIdx = 0; stepIdx < path.steps.length; stepIdx++) {
    const step = path.steps[stepIdx];
    const edge = step.edgeId ? edgesById.get(step.edgeId) : undefined;
    if (!edge) {
      error = `Step references unknown edgeId "${step.edgeId}" - not present in the intended graph.`;
      step.status = "failed";
      step.error = error;
      break;
    }

    if (edge.inputScenarioId) await fillFormScenario(page, scenariosById.get(edge.inputScenarioId));

    const before = page.url();
    const deterministic = buildDeterministicResolution(edge, opts.baseUrl);
    const outcome = await runLoopStep(log, page, episodeId, stepIdx, path.goal, loopOpts, {
      deterministic: deterministic ? async () => deterministic : undefined,
    });
    const after = page.url();
    const actualNodeId = await currentNodeId(page);
    recordNode(nodes, page, actualNodeId);

    const screenshotPath = `${opts.screenshotDir}/${sanitize(path.id)}_${stepsCompleted}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => null);
    screenshotPaths.push(screenshotPath);

    const stepError = outcome.status === "working" ? undefined : outcome.error;
    const status: Edge["status"] = stepError ? "broken" : "working";
    const observedEdge: Edge = {
      id: nextEdgeId(),
      from: edge.from,
      to: outcome.status === "working" ? actualNodeId : null,
      action: edge.action,
      selector: edge.selector,
      isReturnPath: edge.isReturnPath,
      status,
      error: stepError,
      screenshotPath,
      source: "observed",
    };
    edgesObserved.push(observedEdge);
    edgesOut.push(observedEdge);

    step.status = status === "working" ? "passed" : "failed";
    step.actualNodeId = actualNodeId;
    if (stepError) step.error = stepError;

    if (status === "working") {
      stepsCompleted++;
    } else {
      error = observedEdge.error;
      break;
    }
  }

  log.append("episode/end", {
    episodeId,
    status: stepsCompleted === path.steps.length ? "passed" : stepsCompleted > 0 ? "partial" : "failed",
    error,
  });

  const finishedAt = new Date().toISOString();
  const resultStatus: PathRunResult["status"] =
    stepsCompleted === path.steps.length ? "passed" : stepsCompleted > 0 ? "partial" : "failed";
  path.status = resultStatus === "passed" ? "passed" : "failed";

  return {
    result: {
      pathId: path.id,
      personaId: path.personaId,
      goal: path.goal,
      status: resultStatus,
      stepsCompleted,
      stepsTotal: path.steps.length,
      edgesObserved,
      error,
      screenshotPaths,
      startedAt,
      finishedAt,
    },
    nodes,
    edges: edgesOut,
  };
}

/** Turn an intended-graph edge into a deterministic loop resolution, matching
 *  performEdgeAction's old behavior: explicit selector first, then href-like
 *  quoted text navigated directly, then quoted text clicked. Returns undefined
 *  when no grounded action exists (the loop then falls back to the agent). */
function buildDeterministicResolution(edge: Edge, baseUrl: string): StepResolution | undefined {
  if (!edge.action) return undefined;
  const quoted = edge.action.match(/"([^"]*)"/)?.[1];
  if (edge.selector) {
    return { kind: "deterministic", toolName: "click_selector", args: { selector: edge.selector }, reason: "intended-graph selector" };
  }
  if (quoted && isHrefLike(quoted)) {
    const path = quoted.startsWith("http") ? new URL(quoted).pathname : quoted.split("?")[0].split("#")[0];
    return { kind: "deterministic", toolName: "navigate", args: { url: `${baseUrl}${path}` }, reason: "intended-graph href" };
  }
  if (quoted) {
    return { kind: "deterministic", toolName: "click_label", args: { label: quoted }, reason: "intended-graph label" };
  }
  return undefined;
}

/** Fills a detected form's fields with its InputScenario's heuristic values
 *  before the step's submit action runs. Best-effort per field: a select
 *  element rejects fill() and needs selectOption() instead; anything else
 *  that still fails is left as-is - the submit click below still surfaces
 *  the real signal (broken vs correctly-disabled-until-valid). */
async function fillFormScenario(page: Page, scenario: InputScenario | undefined): Promise<void> {
  if (!scenario) return;
  for (const [selector, value] of Object.entries(scenario.values)) {
    const locator = page.locator(selector).first();
    if (typeof value === "boolean") {
      await (value ? locator.check({ timeout: 3000 }) : locator.uncheck({ timeout: 3000 })).catch(() => null);
      continue;
    }
    await locator.fill(String(value), { timeout: 3000 }).catch(() => locator.selectOption(String(value), { timeout: 3000 }).catch(() => null));
  }
}

async function currentNodeId(page: Page): Promise<string> {
  return new URL(page.url()).pathname;
}

function recordNode(nodes: Record<string, Node>, page: Page, id: string): void {
  if (nodes[id]) return;
  nodes[id] = {
    id,
    url: page.url(),
    stateSignature: computeStateSignature(page.url(), id),
    source: "observed",
  };
}

function isHrefLike(s: string): boolean {
  return (s.startsWith("/") || s.startsWith("http")) && !/\s/.test(s);
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "_") || "x";
}

// Re-exported so the CLI and any consumer share one candidate vocabulary.
export { collectCandidates, type Candidate };