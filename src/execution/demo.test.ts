// Spec: v2 §4.3 - see spec/traceability.md
import { test } from "node:test";
import assert from "node:assert/strict";
import { needsFakeMedia, type DemoScreenplay } from "./demo.js";

const step = (over: Record<string, unknown> = {}) => ({ name: "s", ...over });

test("a session step gets Chromium's fake audio device", () => {
  // Regression: the fake-media flags used to be gated on fakeMicWav alone.
  // Transport-agnostic session scenes carry no WAV, so they launched without a
  // fake mic - the product's dialog called getUserMedia, failed, and never
  // opened its socket. The render then timed out waiting for a session that
  // could never start, reporting it as "the session never finished".
  assert.equal(
    needsFakeMedia({ steps: [step({ session: { id: "c", kind: "voice-call", turns: [] } })] }),
    true,
  );
});

test("the older mock/WAV routes still get it", () => {
  assert.equal(needsFakeMedia({ steps: [step()], fakeMicWav: "/tmp/a.wav" }), true);
  assert.equal(needsFakeMedia({ steps: [step()], mockWebSockets: [{ url: "ws://x" }] as never }), true);
});

test("an ordinary click-through demo does not", () => {
  // Launch args are not free; a plain screen tour should not ask for a device.
  assert.equal(needsFakeMedia({ steps: [step({ goto: "/" }), step({ click: "Next" })] }), false);
  assert.equal(needsFakeMedia({ steps: [] }), false);
});

test("the screenplay keeps the field names studio/render.ts projects from", () => {
  // Regression: render.ts read `scenes`/`startSec`/`narration` while the
  // screenplay emits `scene`/`atSec`/`narrate`. The mismatch was swallowed by a
  // bare catch, so every browser segment wrote an empty choreography.json while
  // the render still reported success - and choreography is the render contract
  // (spec §4), not a nicety. A rename here must break loudly, so assert the
  // shape the projection depends on.
  const sp: DemoScreenplay = {
    baseUrl: "http://x", createdAt: "", totalSec: 1,
    scene: [{ atSec: 0, durSec: 1, name: "s1", narrate: "hello" }],
  };
  assert.ok(Array.isArray(sp.scene), "screenplay scenes live under `scene`");
  const [first] = sp.scene;
  assert.equal(typeof first.atSec, "number");
  assert.equal(typeof first.durSec, "number");
  assert.equal(first.narrate, "hello");
});
