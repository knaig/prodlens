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
import { respecFlowToActivity, respecFlowToTrace, respecToDeployment, respecToStateMachine, respecToStaticGraph } from "../adapters/respec";

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

const deployment = respecToDeployment(respec);
writeFileSync(join(publicDir, "deployment.json"), JSON.stringify(deployment, null, 2));
const external = deployment.nodes.filter((n) => n.kind === "provider").length;
console.log(`deployment: ${deployment.nodes.length - 1} components, ${external} outside the trust boundary -> public/data/deployment.json`);

if (respec.flows?.length) {
  const trace = respecFlowToTrace(respec, flowName);
  writeFileSync(join(publicDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.log(`sequence: "${trace.title}" ${trace.actors.length} actors, ${trace.events.length} events -> public/data/trace.json`);

  const activity = respecFlowToActivity(respec, flowName);
  writeFileSync(join(publicDir, "activity.json"), JSON.stringify(activity, null, 2));
  const loops = activity.edges.filter((e) => e.kind === "loopback").length;
  console.log(`activity: ${activity.nodes.length - 2} stages, ${loops} return leg(s) -> public/data/activity.json`);

  // Aggregating one flow just redraws the sequence diagram; it needs several
  // to say anything about which transitions are common.
  if (respec.flows.length > 1) {
    const sm = respecToStateMachine(respec);
    writeFileSync(join(publicDir, "state-machine.json"), JSON.stringify(sm, null, 2));
    console.log(`state machine: ${sm.nodes.length} states, ${sm.edges.length} transitions over ${respec.flows.length} flows -> public/data/state-machine.json`);
  } else {
    console.log("state machine: skipped - needs more than one flow to aggregate");
  }
} else {
  console.log("respec has no flows - skipping sequence, activity and state machine");
}
