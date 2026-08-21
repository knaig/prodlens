// Core data models shared by every stage: static pre-pass, live crawler,
// synthesis, executor, analysis, and reporter all read/write these shapes.
// Aligned to spec/Prodlens-Technical-Spec section 3, with two
// deliberate extensions noted inline where they don't fit the spec's model.

export type Source = "observed" | "inferred" | "code" | "both";
// "both" extends the spec's Node.source union: a node/edge confirmed by both
// the static pass and the live crawl is strictly more certain than either
// alone, and collapsing that into just "observed" or "code" would lose it.

export interface Evidence {
  type: "screenshot" | "dom" | "network" | "console" | "log";
  pathOrValue: string;
  timestamp: string;
}

export interface Node {
  id: string;
  url: string;
  title?: string;
  stateSignature: string; // hash of important DOM + data, for SPA state dedup
  screenshotPath?: string;
  isTerminal?: boolean;
  source: Source;
  /** Set when source includes "code": where this route is defined. */
  sourceFile?: string;
  /** metadata.forms, if present, holds FormDescriptor[] detected on this screen. */
  metadata?: Record<string, any>;
}

/** One form field detected on a screen (live crawl only - needs a real
 *  rendered DOM to know input types/names/required-ness). */
export interface FormField {
  name: string;
  type: string; // input type attribute, or "textarea"/"select"
  selector: string; // resolvable Playwright selector, e.g. [name="email"]
  placeholder?: string;
  required?: boolean;
}

export interface FormDescriptor {
  selector: string;
  fields: FormField[];
  submitSelector?: string;
  submitLabel?: string;
}

/** How a statically-analyzed interactive element (button/link) was classified,
 *  before any live click confirms what it actually does. */
export type StaticClassification =
  | "navigates" // <Link>, router.push, redirect - has a known target
  | "server-action" // onClick calls an imported "use server" function
  | "local-state" // onClick only touches local useState/useReducer, no server call
  | "dead"; // no onClick, no href, no form action - does nothing

export interface Edge {
  id: string;
  from: string;
  to: string | null; // null = broken / no navigation observed
  action: string; // human readable: "Click 'Checkout'"
  selector?: string;
  inputScenarioId?: string;
  isReturnPath: boolean;
  status: "working" | "broken" | "untested" | "unreachable" | "missing";
  error?: string;
  screenshotPath?: string;
  source: Source;
  /** Set when source includes "code". */
  sourceFile?: string;
  sourceLine?: number;
  staticClassification?: StaticClassification;
  evidence?: Evidence[];
}

/** Unversioned graph shape - what the Recovery Engine (static pass, live
 *  crawler) produces before the Graph Store wraps it into a GraphVersion. */
export interface Graph {
  nodes: Record<string, Node>;
  edges: Edge[];
  entryPoints: string[];
}

// ----- Personas & Journeys -----

export interface Persona {
  id: string;
  name: string;
  description: string;
  goals: string[];
  traits?: string[];
  source: "inferred" | "provided" | "refined";
}

export interface InputScenario {
  id: string;
  description: string;
  values: Record<string, string | number | boolean>;
  rationale: string;
  priority: "critical" | "high" | "medium" | "low";
}

/** Grounded in a real edge from the intended graph (edgeId) so the Execution
 *  Engine can drive Playwright deterministically instead of interpreting
 *  free-text actions. `action`/`expectedNodeId` remain for display and for
 *  the goal-oriented agent fallback (post-thin-skeleton, not yet built). */
export interface PathStep {
  edgeId?: string;
  action: string;
  expectedNodeId?: string;
  actualNodeId?: string;
  status?: "pending" | "passed" | "failed";
  error?: string;
  evidence?: Evidence[];
}

export interface PrioritizedPath {
  id: string;
  personaId: string;
  goal: string;
  steps: PathStep[];
  inputScenarioIds?: string[];
  priority: "critical" | "high" | "medium" | "low";
  reason: string;
  status: "planned" | "approved" | "running" | "passed" | "failed" | "skipped";
}

/** Result of executing one PrioritizedPath end to end. */
export interface PathRunResult {
  pathId: string;
  personaId: string;
  goal: string;
  status: "passed" | "failed" | "partial";
  stepsCompleted: number;
  stepsTotal: number;
  edgesObserved: Edge[];
  error?: string;
  screenshotPaths: string[];
  startedAt: string;
  finishedAt: string;
}

// ----- Graph Engineering Artifacts -----

export interface GraphVersion extends Graph {
  id: string;
  type: "intended" | "actual" | "merged";
  createdAt: string;
  parentVersionId?: string;
  metadata?: Record<string, any>;
}

export interface GraphDiff {
  fromVersionId: string;
  toVersionId: string;
  addedNodes: string[];
  removedNodes: string[];
  addedEdges: string[];
  removedEdges: string[];
  changedEdges: string[]; // status or target changed
  missingReturnPaths: string[]; // "from->to"
  deadEnds: string[]; // node ids
}

/** Output of graph/analysis.ts's structural pass - raw findings, independent
 *  of any diff. Used directly by the static-pass/live-crawl-only reports
 *  ("scan", "discover"); folded into Issue[] for the full pipeline report. */
export interface GraphAnalysis {
  unreachableNodes: string[]; // node ids never reached from any entry point
  deadEndNodes: string[]; // reachable nodes with zero working outgoing edges
  missingReturnPaths: { from: string; to: string }[]; // forward edge with no path back
  brokenEdges: Edge[];
  deadStaticElements: Edge[]; // staticClassification === "dead"
  localStateOnlyElements: Edge[]; // staticClassification === "local-state", flagged for triage
}

export interface Issue {
  id: string;
  type: "broken_transition" | "missing_return" | "dead_end" | "unreachable" | "spec_deviation" | "visual";
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  nodeIds?: string[];
  edgeIds?: string[];
  pathId?: string;
  evidence?: Evidence[];
}

export interface VerificationReport {
  summary: {
    nodesCovered: number;
    edgesCovered: number;
    brokenTransitions: number;
    missingReturnPaths: number;
    deadEnds: number;
  };
  issues: Issue[];
  graphDiff?: GraphDiff;
  generatedAt: string;
}

export interface InteractionModel {
  intendedGraph: GraphVersion;
  actualGraph?: GraphVersion;
  diff?: GraphDiff;
  recoveredAt: string;
  sources: ("live" | "code" | "docs")[];
}

// ----- GEPA Support -----

export interface TraceFeedback {
  runId: string;
  module: "recovery" | "synthesis" | "prioritization" | "diagnosis";
  score: number; // scalar for ranking
  feedback: string; // rich natural-language diagnosis
  traceSummary: string; // key steps / observations
  examples?: any[];
}

/** Offline GEPA reflection output: accumulated TraceFeedback distilled into
 *  guidance text injected into the next synthesize() LLM prompt. */
export interface GepaGuidance {
  version: number;
  guidance: string;
  createdAt: string;
  basedOnTraceCount: number;
}
