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

/** Trim on a word boundary. The layout measures text and sizes boxes to fit,
 *  so the only reason to shorten anything is readability - and a hard
 *  character slice cuts mid-word ("...conversationa", "...manage ag"), which
 *  is the truncation this renderer was built to be rid of. */
function trimWords(text: string, max: number): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return (at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[,;:]$/, "") + "…";
}

/** Respec topology -> StaticGraph (structural diagram input).
 *
 *  Edges come from `dependsOn` UNION the flows. A respec's dependsOn is often
 *  sparse - VoicEra's leaves the STT/TTS/LLM servers with no declared
 *  dependants at all - which drew them as orphan boxes floating beside a
 *  connected core. The flows record who actually talks to whom, so folding
 *  them in produces the real topology, and their actions label the edges. */
export function respecToStaticGraph(respec: Respec): StaticGraph {
  const known = new Set(respec.topology.map((c) => c.name));
  const edges = new Map<string, { from: string; to: string; label?: string }>();

  for (const c of respec.topology) {
    for (const d of c.dependsOn ?? []) {
      if (known.has(d)) edges.set(`${c.name}->${d}`, { from: c.name, to: d });
    }
  }
  for (const flow of respec.flows ?? []) {
    for (const s of flow.steps) {
      if (!known.has(s.from) || !known.has(s.to) || s.from === s.to) continue;
      // Collapse reciprocal hops. A flow records a request and its response as
      // two steps ("Send transcribed text" / "Return transcribed text"), which
      // on a static map draws two arrows between the same pair - doubling the
      // edge count and the label collisions for no extra information. The
      // structural view answers "what talks to what"; the sequence diagram is
      // where the back-and-forth belongs.
      if (edges.has(`${s.to}->${s.from}`)) continue;
      edges.set(`${s.from}->${s.to}`, { from: s.from, to: s.to });
    }
  }

  return {
    title: trimWords(respec.oneLiner, 96),
    nodes: respec.topology.map((c) => ({ id: c.name, label: c.name, sublabel: trimWords(c.role, 64), kind: c.kind })),
    // Unlabelled by design: on a map this dense, per-edge text is the thing
    // that collides. Actions are carried by the sequence renderer.
    edges: [...edges.values()],
  };
}
