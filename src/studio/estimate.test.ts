// Spec: v2 §12.2 - see spec/traceability.md
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { estimateSpec, formatEstimate } from "./estimate.js";
import type { DemoSpec2, NarrationDoc } from "./types.js";

const narration: NarrationDoc = {
  language: "en",
  lines: [
    { id: "a", sceneId: "screen1", text: "A line nobody has spoken before, for cache purposes." },
    { id: "b", sceneId: "deploy", text: "Another unspoken line about deployment." },
  ],
};

const base: Omit<DemoSpec2, "scenes"> = {
  version: 2, title: "t", projectId: "p", baseUrl: "http://x",
  voice: { name: "Kore", style: "test-style-that-matches-no-cached-clip" },
};

describe("spend plan", () => {
  test("warns when more than one scene speaks the trace", () => {
    // The real bug: a spec with several diagram scenes re-drafted and
    // re-synthesized the trace once per scene, at whichever scenario each one
    // named. The only evidence was a render log, after the spend.
    const spec: DemoSpec2 = {
      ...base,
      scenes: [
        { id: "seq1", type: "diagram", view: "sequence", scenario: "A" },
        { id: "seq2", type: "diagram", view: "sequence", scenario: "B" },
      ],
    };
    const e = estimateSpec(spec, narration, { traceEvents: 12 });
    assert.equal(e.warnings.length, 1);
    assert.match(e.warnings[0], /re-drafts and re-synthesizes/);
    assert.match(formatEstimate(e).join("\n"), /WARNING/);
  });

  test("one sequence scene raises no warning", () => {
    const spec: DemoSpec2 = {
      ...base,
      scenes: [
        { id: "seq", type: "diagram", view: "sequence", scenario: "A" },
        { id: "deploy", type: "diagram", view: "deployment", narrationIds: ["b"] },
      ],
    };
    assert.deepEqual(estimateSpec(spec, narration, { traceEvents: 12 }).warnings, []);
  });

  test("counts a call scene's spoken turns", () => {
    const spec: DemoSpec2 = {
      ...base,
      scenes: [{
        id: "call", type: "call", sessionKind: "voice-call",
        turns: [
          { speaker: "agent", text: "one" },
          { speaker: "caller", text: "two" },
          { speaker: "agent" }, // no text - the product's own reply, nothing to synthesize
        ],
      }],
    };
    const e = estimateSpec(spec, narration);
    assert.equal(e.scenes[0].clips, 2, "only turns with text are spoken");
  });

  test("a draft costs nothing", () => {
    const spec: DemoSpec2 = {
      ...base,
      scenes: [
        { id: "seq", type: "diagram", view: "sequence", scenario: "A" },
        { id: "call", type: "call", sessionKind: "voice-call", turns: [{ speaker: "agent", text: "hi" }] },
      ],
    };
    const e = estimateSpec(spec, narration, { draft: true, traceEvents: 12 });
    assert.equal(e.newClips, 0);
    assert.ok(e.scenes.every((s) => s.clips === 0));
  });

  test("separates what is cached from what is not knowable here", () => {
    // Browser narration goes through the demo renderer's own TTS chain, whose
    // key includes a generated tts-cmd. Counting it as cached would be a guess.
    const spec: DemoSpec2 = { ...base, scenes: [{ id: "screen1", type: "screen", goto: "/", narrationIds: ["a"] }] };
    const e = estimateSpec(spec, narration);
    assert.equal(e.unknownClips, 1);
    assert.equal(e.newClips, 0);
  });
});
