// Project a real respec into the diagram schema so the renderers draw the
// actual product instead of the hand-written fixture (spec §5.4 build step 5,
// traceability D-DIAGV3-1).
//
// The renderers run in a browser context and cannot read the filesystem, so
// this Node step writes the derived data under public/ where staticFile() can
// reach it - the same channel the narration manifest already uses.
//
// Usage: tsx src/export/prepare.ts <path-to-respec/spec.json> [flow name]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { respecFlowToTrace, respecToStaticGraph } from "../adapters/respec";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "..", "..", "public", "data");

const respecPath = process.argv[2];
if (!respecPath) {
  console.error("usage: tsx src/export/prepare.ts <respec/spec.json> [flow name]");
  process.exit(1);
}
const flowName = process.argv[3];

const respec = JSON.parse(readFileSync(resolve(respecPath), "utf-8"));
mkdirSync(publicDir, { recursive: true });

const graph = respecToStaticGraph(respec);
writeFileSync(join(publicDir, "structural.json"), JSON.stringify(graph, null, 2));
console.log(`structural: ${graph.nodes.length} nodes, ${graph.edges.length} edges -> public/data/structural.json`);

if (respec.flows?.length) {
  const trace = respecFlowToTrace(respec, flowName);
  writeFileSync(join(publicDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.log(`sequence: "${trace.title}" ${trace.actors.length} actors, ${trace.events.length} events -> public/data/trace.json`);
} else {
  console.log("respec has no flows - skipping the sequence trace");
}
