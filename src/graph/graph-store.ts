import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Edge, Graph, GraphDiff, GraphVersion, Node } from "../types.js";
import { matchPathToPattern } from "./route-match.js";

export function saveGraph(graph: Graph, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(graph, null, 2));
}

export function loadGraph(path: string): Graph {
  return JSON.parse(readFileSync(path, "utf-8"));
}

/** Folds a live crawl's concrete URLs (real project slugs, real post ids)
 *  onto the static graph's route patterns, e.g. "/lumen/studio/p4" ->
 *  "/[project]/studio/[id]", so the two graphs merge onto the same node
 *  identity instead of treating every real project's screens as unrelated,
 *  never-merged nodes. Multiple concrete instances of the same pattern
 *  (every post's editor page, say) collapse onto one node - the first one
 *  visited "wins" for node metadata like the screenshot path; this is a
 *  deliberate trade for correct reachability analysis, at the cost of
 *  losing per-instance node detail in the merged graph.json (the individual
 *  screenshots still exist on disk either way). */
export function remapGraphToPatterns(graph: Graph, patterns: string[]): Graph {
  const remap = (path: string): string => matchPathToPattern(path, patterns) ?? path;

  const nodes: Record<string, Node> = {};
  for (const [id, node] of Object.entries(graph.nodes)) {
    const newId = remap(id);
    if (!nodes[newId]) nodes[newId] = { ...node, id: newId };
  }

  const edges: Edge[] = graph.edges.map((e) => ({
    ...e,
    from: remap(e.from),
    to: e.to === null ? null : remap(e.to),
  }));

  return {
    nodes,
    edges,
    entryPoints: [...new Set(graph.entryPoints.map(remap))],
  };
}

/** Combines a static-pass graph with a live-crawl graph. Nodes/edges found by
 *  both get source:"both"; a live edge's observed status always wins
 *  over a static "untested" guess, since the live crawl actually clicked it. */
export function mergeGraphs(staticGraph: Graph, liveGraph: Graph): Graph {
  const nodes: Record<string, Node> = { ...staticGraph.nodes };
  for (const [id, liveNode] of Object.entries(liveGraph.nodes)) {
    const existing = nodes[id];
    nodes[id] = existing ? { ...existing, ...liveNode, source: "both", sourceFile: existing.sourceFile } : liveNode;
  }

  const edgesByKey = new Map<string, Edge>();
  const key = (e: Edge) => `${e.from}=>${e.to ?? "null"}::${e.action}`;
  for (const e of staticGraph.edges) edgesByKey.set(key(e), e);
  for (const e of liveGraph.edges) {
    const k = key(e);
    const existing = edgesByKey.get(k);
    edgesByKey.set(k, existing ? { ...existing, ...e, source: "both" } : e);
  }

  return {
    nodes,
    edges: [...edgesByKey.values()],
    entryPoints: [...new Set([...staticGraph.entryPoints, ...liveGraph.entryPoints])],
  };
}

// ----- Graph Store: versioning + diff + structural algorithms -----
// Spec section 5.2 "Key Operations". Versions persist as one JSON file per
// version under <dir>/versions/<id>.json; no index/manifest in this thin
// skeleton - callers that need "latest of type X" pass the id they got back
// from createVersion/saveVersion explicitly.

let versionCounter = 0;

export function createVersion(
  type: GraphVersion["type"],
  graph: Graph,
  opts?: { parentVersionId?: string; metadata?: Record<string, any> }
): GraphVersion {
  return {
    ...graph,
    id: `${type}-${Date.now()}-${versionCounter++}`,
    type,
    createdAt: new Date().toISOString(),
    parentVersionId: opts?.parentVersionId,
    metadata: opts?.metadata,
  };
}

export function saveVersion(version: GraphVersion, dir: string): string {
  const path = join(dir, "versions", `${version.id}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(version, null, 2));
  return path;
}

export function getVersion(id: string, dir: string): GraphVersion {
  return JSON.parse(readFileSync(join(dir, "versions", `${id}.json`), "utf-8"));
}

export function listVersions(dir: string): string[] {
  const versionsDir = join(dir, "versions");
  try {
    return readdirSync(versionsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -".json".length));
  } catch {
    return [];
  }
}

function buildAdjacency(edges: Edge[], nodeIds: string[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const id of nodeIds) adjacency.set(id, new Set());
  for (const e of edges) {
    if (!e.to || e.status === "broken") continue;
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

export function findDeadEnds(graph: Graph): string[] {
  const nodeIds = Object.keys(graph.nodes);
  const adjacency = buildAdjacency(graph.edges, nodeIds);
  const reachable = bfsReachableFrom(adjacency, graph.entryPoints);
  return nodeIds.filter((id) => reachable.has(id) && (adjacency.get(id)?.size ?? 0) === 0);
}

export function findMissingReturnPaths(graph: Graph): { from: string; to: string }[] {
  const nodeIds = Object.keys(graph.nodes);
  const adjacency = buildAdjacency(graph.edges, nodeIds);
  const missing: { from: string; to: string }[] = [];
  const seenPairs = new Set<string>();
  for (const e of graph.edges) {
    if (!e.to || e.from === e.to) continue;
    if (!nodeIds.includes(e.to) || !nodeIds.includes(e.from)) continue;
    const pairKey = `${e.from}->${e.to}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    if (!bfsReachableFrom(adjacency, [e.to]).has(e.from)) missing.push({ from: e.from, to: e.to });
  }
  return missing;
}

export function computeCoverage(intended: Graph, actual: Graph): { nodesCovered: number; edgesCovered: number; totalNodes: number; totalEdges: number } {
  const actualNodeIds = new Set(Object.keys(actual.nodes));
  const actualEdgeKeys = new Set(actual.edges.map((e) => `${e.from}=>${e.to ?? "null"}::${e.action}`));
  const nodesCovered = Object.keys(intended.nodes).filter((id) => actualNodeIds.has(id)).length;
  const edgesCovered = intended.edges.filter((e) => actualEdgeKeys.has(`${e.from}=>${e.to ?? "null"}::${e.action}`)).length;
  return { nodesCovered, edgesCovered, totalNodes: Object.keys(intended.nodes).length, totalEdges: intended.edges.length };
}

export function diff(from: GraphVersion, to: GraphVersion): GraphDiff {
  const fromNodeIds = new Set(Object.keys(from.nodes));
  const toNodeIds = new Set(Object.keys(to.nodes));
  const addedNodes = [...toNodeIds].filter((id) => !fromNodeIds.has(id));
  const removedNodes = [...fromNodeIds].filter((id) => !toNodeIds.has(id));

  const fromEdgesById = new Map(from.edges.map((e) => [e.id, e]));
  const toEdgesById = new Map(to.edges.map((e) => [e.id, e]));
  const addedEdges = [...toEdgesById.keys()].filter((id) => !fromEdgesById.has(id));
  const removedEdges = [...fromEdgesById.keys()].filter((id) => !toEdgesById.has(id));
  const changedEdges = [...toEdgesById.keys()].filter((id) => {
    const a = fromEdgesById.get(id);
    const b = toEdgesById.get(id)!;
    return a && (a.status !== b.status || a.to !== b.to);
  });

  return {
    fromVersionId: from.id,
    toVersionId: to.id,
    addedNodes,
    removedNodes,
    addedEdges,
    removedEdges,
    changedEdges,
    missingReturnPaths: findMissingReturnPaths(to).map(({ from: f, to: t }) => `${f}->${t}`),
    deadEnds: findDeadEnds(to),
  };
}
