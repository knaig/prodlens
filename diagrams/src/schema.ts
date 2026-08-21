// Shared diagram schema (spec 5.4). Two distinct input shapes:
// - TraceEvent[]: time-based views (sequence, state-machine aggregate)
// - StaticGraph: timeless views (structural, deployment, activity)
// Never fake `t: 0` onto static data - if there's no time axis, use StaticGraph.

export interface TraceEvent {
  /** Seconds, monotonic within one run. */
  t: number;
  /** Actor id - must match a declared Actor. */
  from: string;
  to: string;
  /** ≤6 words, on-diagram text. */
  label: string;
  /** Full sentence for TTS; falls back to label if absent (but don't do that on purpose). */
  narration?: string;
  /** Optional judge score, rendered as a badge on the message. */
  judgeScore?: number;
  /** Citation, doc version, edge id, etc. - carried through for downstream reuse. */
  meta?: Record<string, unknown>;
}

export interface Actor {
  id: string;
  displayName: string;
  role: "persona" | "agent" | "judge" | "guardrail" | "component" | string;
}

export interface Trace {
  title: string;
  actors: Actor[];
  events: TraceEvent[];
}

// ---- static views ----
export interface StaticNode {
  id: string;
  label: string;
  sublabel?: string;
  kind?: string;
  /** Deployment view: parent container id (host -> sandbox -> service nesting). */
  parent?: string;
}
export interface StaticEdge {
  from: string;
  to: string;
  label?: string;
}
export interface StaticGraph {
  title: string;
  nodes: StaticNode[];
  edges: StaticEdge[];
  /** Deployment view: ids of container nodes forming the trust boundary. */
  trustBoundary?: string[];
}

/** Narration manifest produced by pregen: per-event audio file + measured duration. */
export interface NarrationManifest {
  traceTitle: string;
  items: Array<{ index: number; file: string; durationSec: number; text: string; voice: string }>;
}
