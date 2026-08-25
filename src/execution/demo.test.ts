// Spec: v2 §4.3 - see spec/traceability.md
import { test } from "node:test";
import assert from "node:assert/strict";
import { needsFakeMedia } from "./demo.js";

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
