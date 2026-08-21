// Real-data adapters (build step 5): project prodlens artifacts into the
// diagram schema. These make every diagram a view over logs we already emit.
import type { StaticGraph, Trace, TraceEvent } from "../schema";

interface RespecComponent { name: string; kind: string; role: string; dependsOn?: string[]; internals?: Array<{ name: string; role: string }> }
interface RespecFlow { name: string; steps: Array<{ from: string; to: string; action: string }> }
interface Respec { oneLiner: string; topology: RespecComponent[]; flows: RespecFlow[] }

/** Respec flow -> Trace (sequence diagram input). Steps get a nominal 3s
 *  spacing; pregen replaces timing with measured narration durations. */
export function respecFlowToTrace(respec: Respec, flowName?: string): Trace {
  const flow = flowName ? respec.flows.find((f) => f.name === flowName) ?? respec.flows[0] : respec.flows[0];
  if (!flow) throw new Error("respec has no flows");
  const actorIds = [...new Set(flow.steps.flatMap((s) => [s.from, s.to]))];
  const kindOf = (id: string) => respec.topology.find((c) => c.name === id)?.kind ?? "component";
  const events: TraceEvent[] = flow.steps.map((s, i) => ({
    t: i * 3,
    from: s.from,
    to: s.to,
    label: s.action.split(" ").slice(0, 6).join(" "),
    narration: `${s.from} to ${s.to}: ${s.action}.`,
  }));
  return {
    title: flow.name,
    actors: actorIds.map((id) => ({ id, displayName: id, role: kindOf(id) === "data" ? "component" : kindOf(id) })),
    events,
  };
}

/** Respec topology -> StaticGraph (structural diagram input). */
export function respecToStaticGraph(respec: Respec): StaticGraph {
  return {
    title: respec.oneLiner.slice(0, 80),
    nodes: respec.topology.map((c) => ({ id: c.name, label: c.name, sublabel: c.role.slice(0, 48), kind: c.kind })),
    edges: respec.topology.flatMap((c) => (c.dependsOn ?? []).filter((d) => respec.topology.some((t) => t.name === d)).map((d) => ({ from: c.name, to: d }))),
  };
}
