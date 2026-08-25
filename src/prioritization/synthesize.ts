// Spec: FR-RE-4, FR-IS-2, FR-IS-3, FR-GEPA-1 - see spec/traceability.md
// Synthesis Engine (spec sections 3/8, tech spec Stage 3): turns the
// recovered intended graph into personas + PrioritizedPath[]. Every step in
// a path is grounded in a real edge from the intended graph (edgeId), found
// by BFS from an entry point to the LLM-chosen (or heuristically-chosen)
// target node - so the Execution Engine can drive Playwright deterministically
// instead of interpreting free-text actions. Input-scenario selection (spec
// section 8): any node a path passes through that the live crawler found a
// <form> on gets one InputScenario with heuristic values by field type/name
// (see fieldValue below) - grounded onto the edge via edge.inputScenarioId
// so the executor knows which page to fill before which submit action.
import { isLlmConfigured, localChat } from "../llm/local.js";
import type { Edge, FormDescriptor, Graph, GraphVersion, InputScenario, Persona, PrioritizedPath } from "../types.js";

export interface SynthesisOptions {
  maxPersonas?: number;
  maxJourneysPerPersona?: number;
  model?: string;
  /** Guidance text distilled from prior runs' TraceFeedback by the GEPA
   *  reflection loop (src/prioritization/gepa.ts), appended to the LLM
   *  synthesis prompt when present. No-op for the heuristic fallback. */
  gepaGuidance?: string;
}

export interface SynthesisResult {
  personas: Persona[];
  paths: PrioritizedPath[];
  scenarios: InputScenario[];
}

interface Journey {
  personaName: string;
  goal: string;
  targetNodeId: string;
  priority: "critical" | "high" | "medium" | "low";
  reason: string;
}

export async function synthesize(graph: GraphVersion, opts: SynthesisOptions = {}): Promise<SynthesisResult> {
  const maxPersonas = opts.maxPersonas ?? 3;
  const maxJourneysPerPersona = opts.maxJourneysPerPersona ?? 2;

  // isLlmConfigured() only says the env vars EXIST - not that the endpoint
  // answers, the key is live, or the account has credit. A configured-but-
  // failing LLM used to throw straight out of the pipeline, discarding a
  // completed crawl because a key had expired. The heuristic path is the same
  // fallback `full` takes with no LLM at all, so degrade to it and say so
  // loudly (NFR-6): a worse plan beats losing the run.
  let synth: Awaited<ReturnType<typeof synthesizeWithLLM>>;
  if (isLlmConfigured()) {
    try {
      synth = await synthesizeWithLLM(graph, maxPersonas, maxJourneysPerPersona, opts.model, opts.gepaGuidance);
    } catch (e) {
      console.warn(
        `[prioritize] LLM synthesis failed, falling back to heuristic journeys: ${e instanceof Error ? e.message : e}`,
      );
      console.warn("[prioritize] the plan will be shallower than an LLM-planned one - fix the LLM config and re-run to get the real thing.");
      synth = synthesizeHeuristically(graph, maxJourneysPerPersona);
    }
  } else {
    synth = synthesizeHeuristically(graph, maxJourneysPerPersona);
  }
  const { personaDrafts, journeys } = synth;

  const personas: Persona[] = personaDrafts.map((p, i) => ({
    id: `persona-${i}`,
    name: p.name,
    description: p.description,
    goals: p.goals,
    traits: p.traits,
    source: isLlmConfigured() ? "inferred" : "provided",
  }));
  const personaIdByName = new Map(personas.map((p) => [p.name, p.id]));

  const scenarios: InputScenario[] = [];
  const scenarioIdByNode = new Map<string, string>();

  const paths: PrioritizedPath[] = [];
  let pathCounter = 0;
  for (const journey of journeys) {
    const personaId = personaIdByName.get(journey.personaName) ?? personas[0]?.id;
    if (!personaId) continue;
    if (!graph.nodes[journey.targetNodeId]) continue; // LLM hallucinated a node id - skip rather than guess

    const edgePath = shortestEdgePath(graph, graph.entryPoints, journey.targetNodeId);
    if (!edgePath) continue; // no reachable route in the intended graph - not a plannable path

    const inputScenarioIds = new Set<string>();
    for (const e of edgePath) {
      const scenarioId = groundScenarioForEdge(e, graph, scenarioIdByNode, scenarios);
      if (scenarioId) inputScenarioIds.add(scenarioId);
    }

    paths.push({
      id: `path-${pathCounter++}`,
      personaId,
      goal: journey.goal,
      steps: edgePath.map((e) => ({
        edgeId: e.id,
        action: e.action,
        expectedNodeId: e.to ?? undefined,
        status: "pending",
      })),
      inputScenarioIds: inputScenarioIds.size ? [...inputScenarioIds] : undefined,
      priority: journey.priority,
      reason: journey.reason,
      status: "planned",
    });
  }

  return { personas, paths, scenarios };
}

/** If `edge`'s source node has a detected form (crawler.ts/form-scan.ts),
 *  grounds edge.inputScenarioId onto it - mutating the edge object shared
 *  with `graph.edges`, so the caller's saved GraphVersion carries it too -
 *  and returns the scenario id. One scenario per node, cached and reused
 *  across every path that passes through it. */
function groundScenarioForEdge(
  edge: Edge,
  graph: Graph,
  scenarioIdByNode: Map<string, string>,
  scenarios: InputScenario[]
): string | undefined {
  const forms = graph.nodes[edge.from]?.metadata?.forms as FormDescriptor[] | undefined;
  const form = forms?.[0];
  if (!form) return undefined;

  let scenarioId = scenarioIdByNode.get(edge.from);
  if (!scenarioId) {
    scenarioId = `scenario-${scenarios.length}`;
    scenarios.push({
      id: scenarioId,
      description: `Form on ${edge.from}${form.submitLabel ? ` (submit: "${form.submitLabel}")` : ""}`,
      values: Object.fromEntries(form.fields.map((f) => [f.selector, fieldValue(f)])),
      rationale: "Heuristic value chosen from the field's type/name attribute - no semantic understanding of the form's purpose.",
      priority: "medium",
    });
    scenarioIdByNode.set(edge.from, scenarioId);
  }
  edge.inputScenarioId = scenarioId;
  return scenarioId;
}

/** Heuristic fill value for a detected form field, keyed by its type/name -
 *  good enough to get past client-side "is this field non-empty" validation,
 *  not a substitute for a human picking semantically correct test data. */
function fieldValue(field: import("../types.js").FormField): string | number | boolean {
  const name = field.name.toLowerCase();
  if (field.type === "checkbox") return true;
  if (field.type === "number") return 1;
  if (field.type === "email") return "test@example.com";
  if (field.type === "password") return "TestPassword123!";
  if (field.type === "url") return "https://example.com";
  if (field.type === "tel") return "5555550100";
  if (name.includes("title")) return "Test title";
  if (name.includes("name")) return "Test name";
  if (name.includes("email")) return "test@example.com";
  if (name.includes("description") || name.includes("content") || name.includes("body") || field.type === "textarea") {
    return "Test content generated by prodlens.";
  }
  return "Test value";
}

/** BFS shortest path (fewest edges) from any of `starts` to `target`,
 *  returning the sequence of edges taken. Skips broken edges - a broken
 *  transition can't be the basis of a plannable path. */
function shortestEdgePath(graph: Graph, starts: string[], target: string): Edge[] | null {
  const edgesByFrom = new Map<string, Edge[]>();
  for (const e of graph.edges) {
    if (!e.to || e.status === "broken") continue;
    if (!edgesByFrom.has(e.from)) edgesByFrom.set(e.from, []);
    edgesByFrom.get(e.from)!.push(e);
  }

  const cameFrom = new Map<string, Edge>();
  const visited = new Set<string>(starts);
  const queue = [...starts];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === target) {
      const path: Edge[] = [];
      let node = target;
      while (cameFrom.has(node)) {
        const edge = cameFrom.get(node)!;
        path.unshift(edge);
        node = edge.from;
      }
      return path;
    }
    for (const e of edgesByFrom.get(cur) ?? []) {
      if (visited.has(e.to!)) continue;
      visited.add(e.to!);
      cameFrom.set(e.to!, e);
      queue.push(e.to!);
    }
  }
  return null;
}

function synthesizeHeuristically(
  graph: GraphVersion,
  maxJourneysPerPersona: number
): { personaDrafts: { name: string; description: string; goals: string[]; traits?: string[] }[]; journeys: Journey[] } {
  const candidateTargets = Object.keys(graph.nodes)
    .filter((id) => !graph.entryPoints.includes(id))
    .slice(0, maxJourneysPerPersona);

  const journeys: Journey[] = candidateTargets.map((targetNodeId, i) => ({
    personaName: "General user",
    goal: `Reach ${graph.nodes[targetNodeId]?.title || targetNodeId}`,
    targetNodeId,
    priority: i === 0 ? "high" : "medium",
    reason: "Heuristic fallback (no LLM configured): reachable non-entry screen picked in discovery order.",
  }));

  return {
    personaDrafts: [
      {
        name: "General user",
        description: "Placeholder persona used when no LLM is configured for synthesis.",
        goals: candidateTargets.map((id) => `Reach ${id}`),
      },
    ],
    journeys,
  };
}

async function synthesizeWithLLM(
  graph: GraphVersion,
  maxPersonas: number,
  maxJourneysPerPersona: number,
  model?: string,
  gepaGuidance?: string
): Promise<{ personaDrafts: { name: string; description: string; goals: string[]; traits?: string[] }[]; journeys: Journey[] }> {
  const summary = summarizeGraph(graph);

  const tool = {
    name: "emit_synthesis",
    description: "Emit the inferred personas and prioritized journeys for this app.",
    inputSchema: {
      type: "object",
      properties: {
        personas: {
          type: "array",
          minItems: 1,
          maxItems: maxPersonas,
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              goals: { type: "array", items: { type: "string" } },
              traits: { type: "array", items: { type: "string" } },
            },
            required: ["name", "description", "goals"],
          },
        },
        journeys: {
          type: "array",
          items: {
            type: "object",
            properties: {
              personaName: { type: "string" },
              goal: { type: "string" },
              targetNodeId: { type: "string", description: "Must be exactly one of the node ids listed in the graph summary." },
              priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
              reason: { type: "string" },
            },
            required: ["personaName", "goal", "targetNodeId", "priority", "reason"],
          },
        },
      },
      required: ["personas", "journeys"],
    },
  };

  const res = await localChat({
    model,
    maxTokens: 4096,
    tool,
    system:
      "You infer personas and prioritize user journeys for a web app from its recovered navigation graph.",
    text:
      `Here is a recovered navigation graph for a web app:\n\n${summary}\n\n` +
      `Infer up to ${maxPersonas} core personas with realistic goals, then propose up to ${maxJourneysPerPersona} ` +
      `high-value journeys per persona. Each journey's targetNodeId MUST be one of the node ids listed above - ` +
      `pick the screen that best represents where that goal is accomplished. Prioritize journeys most likely to ` +
      `reveal broken flows, missing return paths, or dead ends.` +
      (gepaGuidance ? `\n\nGuidance learned from previous runs (GEPA reflection) - apply it:\n${gepaGuidance}` : ""),
  });
  if (res.error || !res.toolInput) throw new Error(`Synthesis LLM call failed: ${res.error ?? "no tool_use returned"}`);
  const input = res.toolInput as { personas: { name: string; description: string; goals: string[]; traits?: string[] }[]; journeys: Journey[] };
  return { personaDrafts: input.personas ?? [], journeys: input.journeys ?? [] };
}

function summarizeGraph(graph: GraphVersion): string {
  const lines: string[] = [];
  lines.push(`Entry points: ${graph.entryPoints.join(", ")}`);
  lines.push("Nodes:");
  for (const n of Object.values(graph.nodes)) lines.push(`- ${n.id}${n.title ? ` ("${n.title}")` : ""}`);
  lines.push("Edges:");
  for (const e of graph.edges) {
    if (e.status === "broken") continue;
    lines.push(`- ${e.from} --[${e.action}]--> ${e.to ?? "?"}`);
  }
  return lines.join("\n");
}
