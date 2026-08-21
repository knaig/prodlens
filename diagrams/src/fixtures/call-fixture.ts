// Hand-written TraceEvent[] fixture (build step 2): one simulated
// persona-vs-agent call with judge scoring and a guardrail intervention.
// 7 events across 4 actors - exceeds the milestone's 5-events/3-actors bar,
// with labels long enough to catch truncation regressions.
import type { StaticGraph, Trace } from "../schema";

export const callTrace: Trace = {
  title: "Simulated call: refund request with guardrail check",
  actors: [
    { id: "persona", displayName: "Asha (synthetic caller)", role: "persona" },
    { id: "agent", displayName: "Support voice agent", role: "agent" },
    { id: "guardrail", displayName: "Policy guardrail", role: "guardrail" },
    { id: "judge", displayName: "LLM judge", role: "judge" },
  ],
  events: [
    { t: 0.0, from: "persona", to: "agent", label: "asks for full refund", narration: "Asha opens the call asking for a full refund on last month's order, sounding frustrated." },
    { t: 3.1, from: "agent", to: "persona", label: "asks order number", narration: "The agent stays calm and asks for the order number before making any promises.", judgeScore: 0.91 },
    { t: 7.4, from: "persona", to: "agent", label: "gives wrong order id", narration: "Asha reads out an order number that does not exist in the system." },
    { t: 10.2, from: "agent", to: "guardrail", label: "proposes goodwill credit", narration: "The agent drafts a goodwill credit offer and routes it through the policy guardrail first." },
    { t: 13.0, from: "guardrail", to: "agent", label: "blocks: exceeds limit", narration: "The guardrail blocks the draft: the credit exceeds the agent's authorization limit.", judgeScore: 0.34 },
    { t: 16.5, from: "agent", to: "persona", label: "offers escalation path", narration: "The agent recovers gracefully, offering to escalate to a human specialist within one business day.", judgeScore: 0.88 },
    { t: 20.9, from: "judge", to: "agent", label: "scores turn quality", narration: "The judge scores the full exchange: honest recovery, no invented policy, correct escalation." },
  ],
};

/** Static structural fixture (build step 1's proving ground) with deliberately
 *  long labels - the truncation regression test. */
export const structuralFixture: StaticGraph = {
  title: "ProdLens verification stack",
  nodes: [
    { id: "studio", label: "Demo studio & storyboard", sublabel: "script compiler · narration pinning", kind: "frontend" },
    { id: "engine", label: "Verification engine", sublabel: "discover · prioritize · run · report", kind: "backend" },
    { id: "respec", label: "Reverse-engineering respec", sublabel: "code + docs + graph → spec.json", kind: "backend" },
    { id: "renderer", label: "Diagram & narration renderer", sublabel: "elk layout · Remotion export", kind: "worker" },
    { id: "ledger", label: "Metering ledger with monthly caps", sublabel: "flat per-unit estimates", kind: "data" },
    { id: "cloud", label: "Cloud control plane (Vercel)", sublabel: "queue · billing · registry", kind: "provider" },
  ],
  edges: [
    { from: "studio", to: "engine", label: "compiles against graph" },
    { from: "engine", to: "respec", label: "feeds evidence" },
    { from: "respec", to: "renderer", label: "topology + flows" },
    { from: "engine", to: "ledger", label: "records spend" },
    { from: "studio", to: "renderer", label: "scene specs" },
    { from: "cloud", to: "engine", label: "queued jobs" },
  ],
};
