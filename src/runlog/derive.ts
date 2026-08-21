// Pure projections over a run log - the only consumers of the log's raw
// events. deriveGraph rebuilds the screen graph (prodlens' primary artifact)
// from state/observed + edge/observed events; deriveEpisodes summarizes each
// exploration unit; deriveFeedback emits GEPA-ready TraceFeedback. Keeping
// these pure lets the same log drive the live graph, the report, and offline
// reflection without re-running the engine.
import type { AnyRunEvent } from "./events.js";
import type { Edge, Graph, Node, TraceFeedback } from "../types.js";

export function deriveGraph(events: readonly AnyRunEvent[]): Graph {
  const nodes: Record<string, Node> = {};
  const edges: Edge[] = [];
  const entryPoints: string[] = [];

  for (const e of events) {
    switch (e.type) {
      case "run/start": {
        const u = new URL(e.data.baseUrl);
        const root = u.pathname === "/" ? "/" : u.pathname;
        entryPoints.push(root);
        break;
      }
      case "state/observed": {
        if (!nodes[e.data.nodeId]) {
          nodes[e.data.nodeId] = {
            id: e.data.nodeId,
            url: e.data.url,
            title: e.data.title,
            stateSignature: e.data.stateSignature,
            screenshotPath: e.data.screenshotPath,
            source: "observed",
          };
        }
        break;
      }
      case "edge/observed": {
        edges.push({
          id: `log-${e.seq}`,
          from: e.data.from,
          to: e.data.to,
          action: e.data.action,
          selector: e.data.selector,
          isReturnPath: false,
          status: e.data.status === "untested" ? "untested" : e.data.status,
          error: e.data.error,
          source: "observed",
        });
        break;
      }
      default:
        break;
    }
  }

  return { nodes, edges, entryPoints: [...new Set(entryPoints)] };
}

export interface EpisodeSummary {
  episodeId: string;
  goal: string;
  entryPath: string;
  status: string;
  steps: number;
  toolCalls: number;
  fallbacks: number;
  errors: string[];
}

export function deriveEpisodes(events: readonly AnyRunEvent[]): EpisodeSummary[] {
  const starts = new Map<string, { goal: string; entryPath: string }>();
  const ends = new Map<string, { status: string; error?: string }>();
  const stepCount = new Map<string, Set<number>>();
  const toolCount = new Map<string, number>();
  const fallbackCount = new Map<string, number>();
  const errors = new Map<string, string[]>();

  for (const e of events) {
    switch (e.type) {
      case "episode/start":
        starts.set(e.data.episodeId, { goal: e.data.goal, entryPath: e.data.entryPath });
        break;
      case "episode/end":
        ends.set(e.data.episodeId, { status: e.data.status, error: e.data.error });
        break;
      case "step/start": {
        const s = stepCount.get(e.data.episodeId) ?? new Set<number>();
        s.add(e.data.step);
        stepCount.set(e.data.episodeId, s);
        break;
      }
      case "tool/call":
        toolCount.set(e.data.episodeId, (toolCount.get(e.data.episodeId) ?? 0) + 1);
        break;
      case "fallback/used":
        fallbackCount.set(e.data.episodeId, (fallbackCount.get(e.data.episodeId) ?? 0) + 1);
        break;
      case "error": {
        const list = errors.get(e.data.episodeId) ?? [];
        list.push(e.data.message);
        errors.set(e.data.episodeId, list);
        break;
      }
      default:
        break;
    }
  }

  const ids = [...new Set([...starts.keys(), ...ends.keys()])];
  return ids.map((id) => ({
    episodeId: id,
    goal: starts.get(id)?.goal ?? "",
    entryPath: starts.get(id)?.entryPath ?? "",
    status: ends.get(id)?.status ?? "aborted",
    steps: stepCount.get(id)?.size ?? 0,
    toolCalls: toolCount.get(id) ?? 0,
    fallbacks: fallbackCount.get(id) ?? 0,
    errors: errors.get(id) ?? [],
  }));
}

export interface RunSummary {
  mode: string;
  baseUrl: string;
  reason: string;
  episodes: EpisodeSummary[];
}

export function deriveRunSummary(events: readonly AnyRunEvent[]): RunSummary {
  let mode = "";
  let baseUrl = "";
  let reason = "aborted";
  for (const e of events) {
    switch (e.type) {
      case "run/start":
        mode = e.data.mode;
        baseUrl = e.data.baseUrl;
        break;
      case "run/end":
        reason = e.data.reason;
        break;
      default:
        break;
    }
  }
  return { mode, baseUrl, reason, episodes: deriveEpisodes(events) };
}

/** Filter a run log to a single event variant, narrowing the element type -
 *  plain arrow predicates don't narrow Array.prototype.filter results, so
 *  every variant's data would leak into the union downstream. */
function ofType<T extends AnyRunEvent["type"]>(
  events: readonly AnyRunEvent[],
  type: T
): Extract<AnyRunEvent, { type: T }>[] {
  return events.filter((e): e is Extract<AnyRunEvent, { type: T }> => e.type === type);
}

const isError = (e: AnyRunEvent): e is Extract<AnyRunEvent, { type: "error" }> => e.type === "error";
const isFallback = (e: AnyRunEvent): e is Extract<AnyRunEvent, { type: "fallback/used" }> => e.type === "fallback/used";

/** Per-episode GEPA-ready TraceFeedback. Each failed or partial episode
 *  becomes one feedback entry whose score is the fraction of steps that
 *  worked; a clean run yields a single all-pass entry (parity with
 *  buildVerificationReport). Feedback text and traceSummary are drawn from
 *  the episode's error / guard-denial / fallback events, examples carry the
 *  raw deciding events so the GEPA reflection has concrete material. */
export function deriveFeedback(events: readonly AnyRunEvent[]): TraceFeedback[] {
  const runId = events.find((e) => e.type === "run/start")?.data.runId ?? `run-${Date.now()}`;
  const episodeIds = [...new Set(events.filter((e) => e.type === "episode/start").map((e) => e.data.episodeId))];

  if (!episodeIds.length) {
    return [{ runId, module: "diagnosis", score: 1, feedback: "No episodes recorded.", traceSummary: "no steps", examples: [] }];
  }

  const perEpisode = new Map<string, { goal: string; ends: string | undefined; error: string | undefined }>();
  for (const e of events) {
    if (e.type === "episode/start") {
      if (!perEpisode.has(e.data.episodeId)) perEpisode.set(e.data.episodeId, { goal: e.data.goal, ends: undefined, error: undefined });
    } else if (e.type === "episode/end") {
      perEpisode.set(e.data.episodeId, { ...perEpisode.get(e.data.episodeId)!, ends: e.data.status, error: e.data.error });
    }
  }

  const stepOutcome = new Map<string, { working: number; total: number }>();
  for (const e of events) {
    if (e.type !== "step/end") continue;
    const acc = stepOutcome.get(e.data.episodeId) ?? { working: 0, total: 0 };
    acc.total++;
    if (e.data.outcome === "working") acc.working++;
    stepOutcome.set(e.data.episodeId, acc);
  }

  const feedback: TraceFeedback[] = [];
  for (const id of episodeIds) {
    const meta = perEpisode.get(id)!;
    const steps = stepOutcome.get(id);
    const total = steps?.total ?? 0;
    const working = steps?.working ?? 0;
    const score = total ? working / total : meta.ends === "passed" ? 1 : 0;

    const isFor = (e: { data: { episodeId: string } }) => e.data.episodeId === id;
    const related = (events as AnyRunEvent[]).filter((e): e is Extract<AnyRunEvent, { type: "error" | "fallback/used" }> =>
      (isError(e) || isFallback(e)) && e.data.episodeId === id
    );
    const errors = related;
    const denied = errors.filter((e): e is Extract<AnyRunEvent, { type: "error" }> => e.type === "error" && e.data.code === "GUARD_DENIED");
    const decisions = ofType(events, "agent/decide").filter(isFor);
    const calls = ofType(events, "tool/call").filter(isFor);

    const lines: string[] = [];
    if (denied.length) lines.push(`${denied.length} tool call(s) denied by guards: ${denied.map((d) => d.data.message).join("; ")}`);
    for (const f of ofType(events, "fallback/used").filter(isFor)) lines.push(`fallback at step ${f.data.step} resolved by ${f.data.resolvedBy} (${f.data.reason})`);
    for (const d of decisions) lines.push(`step ${d.data.step}: chose ${JSON.stringify(d.data.chosen)} via ${d.data.resolve} - ${d.data.reason}`);
    const errText = meta.error
      ? [meta.error]
      : errors.filter((e): e is Extract<AnyRunEvent, { type: "error" }> => e.type === "error" && e.data.code !== "GUARD_DENIED").map((e) => e.data.message);

    if (score >= 1 && !errors.length && !denied.length) {
      feedback.push({
        runId,
        module: "diagnosis",
        score: 1,
        feedback: `Episode ${id} passed all steps.`,
        traceSummary: `${calls.length} tool call(s) across ${total} step(s)${decisions.length ? `, ${decisions.length} agent decision(s)` : ""}`,
        examples: [],
      });
      continue;
    }

    feedback.push({
      runId,
      module: "diagnosis",
      score,
      feedback: errText.length
        ? `Episode ${id} (${meta.ends ?? "aborted"}): ${[...new Set(errText)].join(" | ")}`
        : `Episode ${id} (${meta.ends ?? "aborted"}): ${denied.length ? "blocked by guard denials" : "did not complete all steps"}`,
      traceSummary: `${working}/${total} step(s) worked; ${calls.length} tool call(s); ${lines.length ? lines.join("; ") : "no fallbacks"}`,
      examples: [...denied, ...errors, ...decisions].map((e) => ({ seq: e.seq, type: e.type, ...e.data })),
    });
  }
  return feedback;
}
