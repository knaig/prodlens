// Append-only run log event vocabulary (dsh session-log analogue). A run is
// one engine invocation; an episode is one exploration unit (a journey
// executed, or one guided crawl); a step is one agent decision plus the tool
// calls it issued. Every payload is lossless JSON and seq is contiguous, so
// the log is the single source of truth from which the graph, episodes, and
// GEPA feedback are derived (see derive.ts). Merge-extensible: switch over
// RunEvent must fall through on unknown types, never assertNever.

export type RunEventType = keyof RunEventMap;

export interface RunEventMap {
  "run/start": { runId: string; baseUrl: string; mode: "explore" | "run" };
  "run/end": { reason: "completed" | "aborted" | "error"; error?: string };

  "episode/start": { episodeId: string; goal: string; entryPath: string };
  "episode/end": { episodeId: string; status: "passed" | "partial" | "failed" | "aborted"; error?: string };

  /** One agent decision: what it considered, what it chose, and why. */
  "agent/decide": {
    episodeId: string;
    step: number;
    goal: string;
    candidates: string[];
    chosen: string;
    reason: string;
    resolve: "deterministic" | "agent";
  };

  "step/start": { episodeId: string; step: number };
  "step/end": { episodeId: string; step: number; outcome: "working" | "broken" | "blocked" };

  "tool/call": { episodeId: string; step: number; callId: string; name: string; arguments: Record<string, unknown> };
  "tool/result": {
    episodeId: string;
    step: number;
    callId: string;
    name: string;
    isError: boolean;
    value?: unknown;
    error?: string;
  };

  "state/observed": {
    episodeId: string;
    nodeId: string;
    url: string;
    stateSignature: string;
    title?: string;
    screenshotPath?: string;
  };

  "edge/observed": {
    episodeId: string;
    from: string;
    to: string | null;
    action: string;
    selector?: string;
    status: "working" | "broken" | "untested";
    error?: string;
  };

  /** A step the deterministic edge resolution could not handle and an agent
   *  decision resolved it instead (or failed to). */
  "fallback/used": { episodeId: string; step: number; reason: string; resolvedBy: string };

  "error": { episodeId: string; step: number; message: string; code: string };
}

export type RunEvent<T extends RunEventType = RunEventType> = {
  [K in RunEventType]: {
    type: K;
    /** Monotonic position in the log (always log.length). */
    seq: number;
    /** Unix epoch milliseconds. */
    time: number;
    data: RunEventMap[K];
  };
}[T];

/** One log entry, discriminant-narrowed by `type`. */
export type AnyRunEvent = RunEvent<RunEventType>;
