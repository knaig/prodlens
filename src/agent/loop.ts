// The agentic exploration loop (dsh agent-loop analogue): one step is one
// decision plus the tool calls it issued. A step starts by collecting the
// current page's candidate actions, resolves one (deterministically from an
// intended edge, or by asking the LLM with a forced choose_action tool), runs
// the browser tool behind the guard chain, records the observed state and
// edge, and logs the whole step to the run log. Loop-window and step caps give
// bounded termination; go_back recovery is the loop's escape from dead ends.
import type { Page } from "playwright";
import type { RunLog } from "../runlog/store.js";
import { computeStateSignature } from "../discovery/state-signature.js";
import { localChat, isLlmConfigured } from "../llm/local.js";
import { browserTools, getBrowserTool, runBrowserTool, type ToolArgs } from "./tools.js";
import { defaultGuards, guardTool, type GuardContext } from "./guards.js";

export interface LoopOptions {
  baseUrl: string;
  screenshotDir?: string;
  actionTimeoutMs?: number;
  settleMs?: number;
  /** Maximum steps per episode. Default 25. */
  maxSteps?: number;
  /** Same action consecutive times before calling a loop. Default 3. */
  loopWindow?: number;
  dangerousLabelPattern?: RegExp;
  /** True once the auth adapter finished. Default false. */
  authed?: boolean;
}

export interface Candidate {
  /** The action the resolver can actually execute. */
  label: string;
  kind: "link" | "button" | "text";
  /** For href-like links, the synthetic navigate action instead of a click. */
  href?: string;
}

export interface StepResolution {
  kind: "deterministic" | "agent";
  toolName: string;
  args: ToolArgs;
  reason: string;
}

export interface StepOutcome {
  status: "working" | "broken" | "blocked";
  before: string;
  after: string;
  error?: string;
}

export interface EpisodeHooks {
  /** Collect candidate actions for the current page. Defaults to collectCandidates(). */
  collectCandidates?: (page: Page, step: number) => Promise<Candidate[]>;
  /** Deterministic first choice; undefined -> default to agent decision. */
  deterministic?: (page: Page, step: number, candidates: Candidate[]) => Promise<StepResolution | undefined>;
  /** Called after a working navigation with the observed before/after paths. */
  onNavigated?: (before: string, after: string, step: number) => void;
}

/** Collect the page's clickable labels and hrefs as step candidates. */
export async function collectCandidates(page: Page, step: number): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const hrefs = await page
    .$$eval("a[href]", (as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")).filter((h): h is string => !!h))
    .catch(() => [] as string[]);
  for (const href of new Set(hrefs)) {
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    candidates.push({ label: `Navigate to "${href}"`, kind: "link", href });
  }
  const count = await page.locator("button:visible, a:visible, [role='button']:visible").count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const el = page.locator("button:visible, a:visible, [role='button']:visible").nth(i);
    const text = (await el.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    if (!text || text.length > 60) continue;
    const tag = await el.evaluate((n) => n.tagName.toLowerCase()).catch(() => "");
    if (!candidates.some((c) => c.label === `Click "${text}"`)) {
      candidates.push({ label: `Click "${text}"`, kind: tag === "a" ? "link" : "button" });
    }
  }
  return candidates.slice(0, 40);
}

/** Ask the LLM to pick among candidate actions given the goal. */
export async function decideByAgent(
  goal: string,
  candidates: Candidate[],
  step: number,
  opts: { model?: string } = {}
): Promise<StepResolution | undefined> {
  if (!isLlmConfigured()) return undefined;
  const tool = {
    name: "choose_action",
    description: "Pick the candidate action that best accomplishes the goal, or provide a direct navigate url.",
    inputSchema: {
      type: "object",
      properties: {
        index: { type: "integer", description: "Index of the chosen candidate (choose from the list)" },
        reason: { type: "string", description: "Why this action?" },
      },
      required: ["index", "reason"],
    },
  };
  const list = candidates.map((c, i) => `${i}: ${c.label}`).join("\n");
  const res = await localChat({
    model: opts.model,
    maxTokens: 256,
    tool,
    system: "You are a product exploration agent discovering how a web app works. Pick the most informative next action.",
    text: `Goal: "${goal}"\nCurrent candidates:\n${list}\n\nPick the index of the action that best progresses the understanding of this product.`,
  });
  if (res.error || res.toolInput === undefined) return undefined;
  const idx = typeof res.toolInput.index === "number" ? res.toolInput.index : Number(res.toolInput.index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= candidates.length) return undefined;
  const chosen = candidates[idx];
  if (chosen.kind === "link") {
    return { kind: "agent", toolName: "navigate", args: { url: chosen.href ?? chosen.label.replace(/^Navigate to "/, "").replace(/"$/, "") }, reason: String(res.toolInput.reason ?? "") };
  }
  return { kind: "agent", toolName: "click_label", args: { label: chosen.label.replace(/^Click "/, "").replace(/"$/, "") }, reason: String(res.toolInput.reason ?? "") };
}

/** Run one exploration step against a live page, logging everything. Returns
 *  the outcome; caller owns step ordering and terminates on broken/blocked. */
export async function runLoopStep(
  log: RunLog,
  page: Page,
  episodeId: string,
  step: number,
  goal: string,
  opts: LoopOptions,
  hooks: EpisodeHooks = {}
): Promise<StepOutcome> {
  log.append("step/start", { episodeId, step });
  const before = page.url();
  const screenshotDir = opts.screenshotDir;

  const candidates = hooks.collectCandidates ? await hooks.collectCandidates(page, step) : await collectCandidates(page, step);
  let resolution = hooks.deterministic ? await hooks.deterministic(page, step, candidates) : undefined;
  let resolve: "deterministic" | "agent" = "agent";
  if (!resolution) {
    resolution = await decideByAgent(goal, candidates, step);
  } else {
    resolve = "deterministic";
  }

  if (!resolution) {
    const outcome: StepOutcome = { status: "blocked", before, after: before, error: "no resolvable action and no agent (LLM absent or refused)" };
    log.append("step/end", { episodeId, step, outcome: "blocked" });
    return outcome;
  }

  const chosenLabel =
    resolution.kind === "agent" ? candidates.find((c) => c.label.includes(String(resolution.args.label ?? "")))?.label : "";
  log.append("agent/decide", {
    episodeId,
    step,
    goal,
    candidates: candidates.map((c) => c.label),
    chosen: chosenLabel ?? String(resolution.args.label ?? resolution.args.url ?? ""),
    reason: resolution.reason,
    resolve,
  });

  const tool = getBrowserTool(resolution.toolName);
  if (!tool) {
    log.append("error", { episodeId, step, message: `unknown tool "${resolution.toolName}"`, code: "UNKNOWN_TOOL" });
    log.append("step/end", { episodeId, step, outcome: "blocked" });
    return { status: "blocked", before, after: before, error: `unknown tool "${resolution.toolName}"` };
  }

  const guardCtx: GuardContext = {
    baseUrl: opts.baseUrl,
    dangerousLabelPattern: opts.dangerousLabelPattern,
    authed: opts.authed ?? false,
  };
  const callId = `${episodeId}:s${step}:c${log.length}`;
  log.append("tool/call", { episodeId, step, callId, name: tool.name, arguments: resolution.args });

  const guarded = await guardTool(defaultGuards, guardCtx, tool.name, resolution.args, page);
  if (guarded.kind === "deny") {
    log.append("tool/result", { episodeId, step, callId, name: tool.name, isError: true, error: guarded.reason });
    log.append("error", { episodeId, step, message: guarded.reason, code: "GUARD_DENIED" });
    log.append("step/end", { episodeId, step, outcome: "blocked" });
    return { status: "blocked", before, after: before, error: guarded.reason };
  }

  const result = await runBrowserTool(tool, page, resolution.args, { timeoutMs: opts.actionTimeoutMs ?? 8000, baseUrl: opts.baseUrl });
  log.append("tool/result", { episodeId, step, callId, name: tool.name, isError: !result.ok, value: result.ok ? result.value : undefined, error: result.error });
  if (!result.ok) {
    log.append("step/end", { episodeId, step, outcome: "broken" });
    return { status: "broken", before, after: before, error: result.error };
  }

  await page.waitForTimeout(opts.settleMs ?? 400);
  const after = page.url();
  const nodeId = new URL(after).pathname;
  const title = await page.title().catch(() => "");
  const signature = computeStateSignature(after, title);
  if (screenshotDir) {
    const shotPath = `${screenshotDir}/ep${episodeId}_s${step}.png`;
    await page.screenshot({ path: shotPath, fullPage: false }).catch(() => null);
    log.append("state/observed", { episodeId, nodeId, url: after, stateSignature: signature, title, screenshotPath: shotPath });
  } else {
    log.append("state/observed", { episodeId, nodeId, url: after, stateSignature: signature, title });
  }

  const beforeNode = new URL(before).pathname;
  const navigated = beforeNode !== nodeId;
  log.append("edge/observed", {
    episodeId,
    from: beforeNode,
    to: navigated ? nodeId : null,
    action: resolution.args.label !== undefined ? `Click "${resolution.args.label}"` : `Navigate to "${resolution.args.url}"`,
    selector: resolution.args.selector !== undefined ? String(resolution.args.selector) : undefined,
    status: navigated ? "working" : "broken",
    error: navigated ? undefined : "Action ran but the page did not navigate.",
  });
  log.append("step/end", { episodeId, step, outcome: navigated ? "working" : "broken" });
  if (navigated && hooks.onNavigated) hooks.onNavigated(beforeNode, nodeId, step);
  return { status: navigated ? "working" : "broken", before, after, error: navigated ? undefined : "Action ran but the page did not navigate." };
}

/** Drive an episode (one goal/entry) to bounded termination. Returns the final
 *  per-episode status. `keepGoing` decides whether to continue after a working
 *  step (explore) or stop (verify). */
export async function runEpisode(
  log: RunLog,
  page: Page,
  episodeId: string,
  goal: string,
  entryPath: string,
  opts: LoopOptions,
  hooks: EpisodeHooks = {},
  keepGoing: (step: number) => boolean = () => false
): Promise<"passed" | "partial" | "failed"> {
  log.append("episode/start", { episodeId, goal, entryPath });
  log.append("tool/call", { episodeId, step: -1, callId: `${episodeId}:entry`, name: "navigate", arguments: { url: entryPath } });
  const entryNav = await runBrowserTool(getBrowserTool("navigate")!, page, { url: entryPath }, { timeoutMs: opts.actionTimeoutMs ?? 20000, baseUrl: opts.baseUrl });
  log.append("tool/result", { episodeId, step: -1, callId: `${episodeId}:entry`, name: "navigate", isError: !entryNav.ok, value: entryNav.ok ? entryNav.value : undefined, error: entryNav.error });
  if (!entryNav.ok) {
    log.append("episode/end", { episodeId, status: "failed", error: entryNav.error });
    return "failed";
  }
  await page.waitForTimeout(opts.settleMs ?? 400);
  const entryUrl = page.url();
  const nodeId = new URL(entryUrl).pathname;
  const title = await page.title().catch(() => "");
  log.append("state/observed", { episodeId, nodeId, url: entryUrl, stateSignature: computeStateSignature(entryUrl, title), title });

  const maxSteps = opts.maxSteps ?? 25;
  const loopWindow = opts.loopWindow ?? 3;
  let lastAction = "";
  let repeatCount = 0;
  let stepsOk = 0;

  for (let step = 0; step < maxSteps; step++) {
    const outcome = await runLoopStep(log, page, episodeId, step, goal, opts, hooks);
    if (outcome.status === "working") {
      stepsOk++;
      if (outcome.after) lastAction = outcome.after;
      if (keepGoing(step)) continue;
      log.append("episode/end", { episodeId, status: "passed" });
      return "passed";
    }
    if (outcome.status === "blocked") {
      // Dead end: back up and retry unless we already looped.
      if (repeatCount >= loopWindow) {
        log.append("episode/end", { episodeId, status: "failed", error: "blocked after repeated dead ends" });
        return "failed";
      }
      repeatCount++;
      const back = await runBrowserTool(getBrowserTool("go_back")!, page, {}, { timeoutMs: opts.actionTimeoutMs ?? 8000, baseUrl: opts.baseUrl }).catch(() => ({ ok: false as boolean }));
      if (!back.ok) {
        log.append("episode/end", { episodeId, status: "failed", error: outcome.error ?? "blocked and could not go back" });
        return "failed";
      }
      continue;
    }
    // broken (action ran, no navigation)
    log.append("episode/end", { episodeId, status: "failed", error: outcome.error ?? "broken step" });
    return "failed";
  }
  log.append("episode/end", { episodeId, status: stepsOk > 0 ? "partial" : "failed", error: "step budget exhausted" });
  return stepsOk > 0 ? "partial" : "failed";
}