// Spec: FR-VE-4, FR-GE-3 - see spec/traceability.md
// Turns a raw Graph into the findings the reporter renders: unreachable
// screens, dead ends, missing return paths, broken edges, and the static
// classifications worth a human's attention.
import type { Edge, Graph, GraphAnalysis, GraphDiff, GraphVersion, Issue, PathRunResult, TraceFeedback, VerificationReport } from "../types.js";
import { computeCoverage } from "./graph-store.js";

/** Shared components (Shell.tsx, ui.tsx) resolve to from:"*" in the static
 *  pass because they're not colocated with one route. In this codebase
 *  they're rendered by the (app) layout, so they apply to every page nested
 *  under an (app) route group. This is a heuristic, not real import-graph
 *  tracing - documented as a known simplification (see README "Limitations"). */
function expandWildcardEdges(graph: Graph): Edge[] {
  const appNodes = Object.values(graph.nodes).filter((n) => (n.sourceFile ?? "").includes("(app)"));
  const expanded: Edge[] = [];
  for (const edge of graph.edges) {
    if (edge.from !== "*") {
      expanded.push(edge);
      continue;
    }
    for (const node of appNodes) {
      expanded.push({ ...edge, id: `${edge.id}::${node.id}`, from: node.id });
    }
  }
  return expanded;
}

function buildAdjacency(edges: Edge[], nodeIds: string[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const id of nodeIds) adjacency.set(id, new Set());
  for (const e of edges) {
    if (!e.to) continue;
    if (e.staticClassification && e.staticClassification !== "navigates") continue;
    if (e.status === "broken") continue;
    if (!adjacency.has(e.from)) adjacency.set(e.from, new Set());
    adjacency.get(e.from)!.add(e.to);
  }
  return adjacency;
}

function bfsReachableFrom(adjacency: Map<string, Set<string>>, starts: string[]): Set<string> {
  const reachable = new Set<string>();
  const queue = [...starts];
  while (queue.length) {
    const cur = queue.shift()!;
    if (reachable.has(cur)) continue;
    reachable.add(cur);
    for (const next of adjacency.get(cur) ?? []) if (!reachable.has(next)) queue.push(next);
  }
  return reachable;
}

function canReach(adjacency: Map<string, Set<string>>, from: string, to: string): boolean {
  return bfsReachableFrom(adjacency, [from]).has(to);
}

export function analyzeGraph(graph: Graph): GraphAnalysis {
  const edges = expandWildcardEdges(graph);
  const nodeIds = Object.keys(graph.nodes);
  const adjacency = buildAdjacency(edges, nodeIds);

  const reachable = bfsReachableFrom(adjacency, graph.entryPoints);
  const unreachableNodes = nodeIds.filter((id) => !reachable.has(id));
  const deadEndNodes = nodeIds.filter((id) => reachable.has(id) && (adjacency.get(id)?.size ?? 0) === 0);

  const missingReturnPaths: { from: string; to: string }[] = [];
  const seenPairs = new Set<string>();
  for (const e of edges) {
    if (!e.to || e.from === "*" || e.from === e.to) continue;
    if (!nodeIds.includes(e.to) || !nodeIds.includes(e.from)) continue;
    const pairKey = `${e.from}->${e.to}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    if (!canReach(adjacency, e.to, e.from)) missingReturnPaths.push({ from: e.from, to: e.to });
  }

  return {
    unreachableNodes,
    deadEndNodes,
    missingReturnPaths,
    brokenEdges: edges.filter((e) => e.status === "broken"),
    deadStaticElements: edges.filter((e) => e.staticClassification === "dead"),
    localStateOnlyElements: edges.filter((e) => e.staticClassification === "local-state"),
  };
}

/** Analysis Engine (spec section 3/11 AnalysisEngine.analyze): combines the
 *  intended/actual GraphDiff with per-path execution results into the
 *  VerificationReport + TraceFeedback the full pipeline reports on. */
export function buildVerificationReport(
  intended: GraphVersion,
  actual: GraphVersion,
  graphDiff: GraphDiff,
  results: PathRunResult[]
): { report: VerificationReport; feedback: TraceFeedback[] } {
  const issues: Issue[] = [];

  for (const nodeId of graphDiff.deadEnds) {
    issues.push({
      id: `issue-dead-end-${nodeId}`,
      type: "dead_end",
      severity: "medium",
      title: `Dead end at ${nodeId}`,
      description: `${nodeId} is reachable but has no working outgoing transitions in the actual graph.`,
      nodeIds: [nodeId],
    });
  }

  for (const pair of graphDiff.missingReturnPaths) {
    const [from, to] = pair.split("->");
    issues.push({
      id: `issue-missing-return-${pair}`,
      type: "missing_return",
      severity: "high",
      title: `Missing return path from ${to} to ${from}`,
      description: `A transition ${from} -> ${to} was observed, but no path back from ${to} to ${from} exists in the actual graph.`,
      nodeIds: [from, to],
    });
  }

  for (const e of actual.edges) {
    if (e.status !== "broken") continue;
    issues.push({
      id: `issue-broken-${e.id}`,
      type: "broken_transition",
      severity: "critical",
      title: `Broken transition: ${e.action}`,
      description: e.error ?? `${e.action} on ${e.from} did not behave as expected.`,
      nodeIds: [e.from, ...(e.to ? [e.to] : [])],
      edgeIds: [e.id],
      evidence: e.evidence,
    });
  }

  for (const id of graphDiff.removedNodes) {
    issues.push({
      id: `issue-unreachable-${id}`,
      type: "unreachable",
      severity: "high",
      title: `Intended screen never reached: ${id}`,
      description: `${id} is in the intended graph but was not reached during execution.`,
      nodeIds: [id],
    });
  }

  for (const r of results) {
    if (r.status === "passed") continue;
    issues.push({
      id: `issue-path-${r.pathId}`,
      type: "spec_deviation",
      severity: r.status === "failed" ? "critical" : "medium",
      title: `Path ${r.status}: ${r.goal}`,
      description: r.error ?? `Completed ${r.stepsCompleted}/${r.stepsTotal} steps.`,
      pathId: r.pathId,
    });
  }

  const coverage = computeCoverage(intended, actual);
  const report: VerificationReport = {
    summary: {
      nodesCovered: coverage.nodesCovered,
      edgesCovered: coverage.edgesCovered,
      brokenTransitions: issues.filter((i) => i.type === "broken_transition").length,
      missingReturnPaths: graphDiff.missingReturnPaths.length,
      deadEnds: graphDiff.deadEnds.length,
    },
    issues,
    graphDiff,
    generatedAt: new Date().toISOString(),
  };

  const passed = results.filter((r) => r.status === "passed").length;
  const feedback: TraceFeedback[] = [
    {
      runId: actual.id,
      module: "diagnosis",
      score: results.length ? passed / results.length : 0,
      feedback:
        issues.length === 0
          ? "No issues found: all executed paths passed and the actual graph matches the intended graph."
          : `Found ${issues.length} issue(s): ${issues.map((i) => i.type).join(", ")}.`,
      traceSummary: `${passed}/${results.length} paths passed. Coverage: ${coverage.nodesCovered}/${coverage.totalNodes} nodes, ${coverage.edgesCovered}/${coverage.totalEdges} edges.`,
      examples: issues.slice(0, 5),
    },
  ];

  return { report, feedback };
}
