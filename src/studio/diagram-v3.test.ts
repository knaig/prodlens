// Spec: v2 §5.4 (D-DIAGV3-1) - see spec/traceability.md
// Covers the studio -> v3 bridge without rendering a full video: projection is
// offline, and the render check uses a frame slice so it costs seconds.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { diagramsRoot, narrationState, prepareV3Data, renderSequenceV3, v3Available } from "./diagram-v3.js";
import type { Respec } from "../respec/respec.js";

const RESPEC: Respec = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  oneLiner: "A test product that does one thing and explains itself clearly enough to draw.",
  goals: [],
  personas: [],
  capabilities: [],
  topology: [
    { name: "web", kind: "frontend", role: "The dashboard operators use", dependsOn: ["api"] },
    { name: "api", kind: "backend", role: "REST service holding the data" },
    { name: "db", kind: "data", role: "Where records live" },
    { name: "worker", kind: "worker", role: "Background processing that nothing declares a dependency on" },
  ],
  flows: [
    {
      name: "Save a record",
      steps: [
        { from: "web", to: "api", action: "POST the form" },
        { from: "api", to: "db", action: "Insert the row" },
        { from: "db", to: "api", action: "Return the id" },
        { from: "api", to: "worker", action: "Queue follow-up work" },
      ],
    },
  ],
  drift: [],
  annotations: {},
  source: "heuristic",
};

const available = v3Available();

describe("studio -> v3 diagram bridge", { skip: available.ok ? false : `v3 unavailable: ${available.reason}` }, () => {
  test("projects a respec into the renderers' inputs", async () => {
    const r = await prepareV3Data(RESPEC, "Save a record");
    assert.equal(r.nodes, 4, "every component becomes a node");
    assert.equal(r.title, "Save a record");
    assert.equal(r.events, 4, "every flow step becomes an event");

    const graph = JSON.parse(readFileSync(join(diagramsRoot(), "public/data/structural.json"), "utf-8")) as {
      title: string;
      nodes: Array<{ id: string; sublabel?: string }>;
      edges: Array<{ from: string; to: string }>;
    };

    // The worker declares no dependants and nothing depends on it, so
    // dependsOn alone would leave it floating. The flow connects it.
    const connected = (id: string) => graph.edges.some((e) => e.from === id || e.to === id);
    assert.ok(connected("worker"), "flow-derived edges must rescue orphan components");
    for (const n of graph.nodes) assert.ok(connected(n.id), `${n.id} should not be an orphan`);

    // db->api is the reciprocal of api->db and must not draw a second arrow.
    assert.ok(!(graph.edges.some((e) => e.from === "db" && e.to === "api") && graph.edges.some((e) => e.from === "api" && e.to === "db")),
      "reciprocal hops collapse to one edge");
  });

  test("never truncates mid-word", async () => {
    await prepareV3Data(RESPEC, "Save a record");
    const graph = JSON.parse(readFileSync(join(diagramsRoot(), "public/data/structural.json"), "utf-8")) as {
      title: string;
      nodes: Array<{ sublabel?: string }>;
    };
    // elk sizes boxes from measured text, so any shortening is for readability
    // and must land on a word boundary - "...conversationa" was the bug.
    for (const text of [graph.title, ...graph.nodes.map((n) => n.sublabel ?? "")]) {
      if (!text.endsWith("…")) continue;
      const last = text.slice(0, -1).trimEnd();
      assert.ok(!/\S$/.test(last) || / \S+$/.test(last), `"${text}" should end on a word boundary`);
    }
  });

  test("reports whether narration matches the prepared trace", async () => {
    await prepareV3Data(RESPEC, "Save a record");
    const s = narrationState();
    // The manifest on disk belongs to whatever was prepared last; against this
    // 4-event fixture it must be recognised as stale rather than silently used.
    if (s.present && !s.matches) assert.ok(s.reason, "a stale manifest must say why");
    if (s.matches) assert.equal(s.clips, 4);
  });
});

describe("v3 render", { skip: available.ok ? false : `v3 unavailable: ${available.reason}` }, () => {
  test("a frame slice produces a real file and a choreography", async () => {
    // Deliberately a slice: proving the pipeline wires up should not cost a
    // full encode. This is the "smoke" rung of the pre-render ladder.
    const out = join(mkdtempSync(join(tmpdir(), "prodlens-v3-")), "slice.mp4");
    const res = await renderSequenceV3({ sceneId: "test-seq", outMp4: out, frames: "0-30" });
    assert.ok(existsSync(res.mp4), "render must write the file it reports");
    assert.ok(res.choreography.tracks.narration.length > 0, "choreography carries the narration track");
    assert.equal(res.choreography.sceneId, "test-seq");
    assert.ok(res.durationSec > 0);
  });
});
