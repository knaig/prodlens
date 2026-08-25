// Spec: v2 §4.3 - see spec/traceability.md
// Proves the session contract end to end against a real page: a scene carrying
// only sessionKind + turns is executed by an adapter, with no transport
// knowledge anywhere in core.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { domChatSessionAdapter } from "./session-dom-adapter.js";
import { listAdapters } from "./engine.js";

// A minimal chat UI: typing and sending appends a message, and the "product"
// answers after a beat. Stands in for any real chat surface.
const CHAT_PAGE = `
<!doctype html><meta charset="utf-8">
<ul id="log"></ul>
<input id="msg" type="text">
<button type="submit" id="send">Send</button>
<script>
  const log = document.getElementById('log');
  const add = (who, text) => {
    const li = document.createElement('li');
    li.dataset.message = who; li.textContent = text; log.appendChild(li);
  };
  document.getElementById('send').addEventListener('click', () => {
    const input = document.getElementById('msg');
    if (!input.value) return;
    add('user', input.value);
    const said = input.value;
    input.value = '';
    setTimeout(() => add('product', 'echo: ' + said), 60);
  });
</script>`;

const SELECTORS = { domChat: { input: "#msg", send: "#send", message: "li[data-message]" } };

/** Runs `fn` against a fresh chat page. The browser is closed in a finally so a
 *  failing assertion cannot leak a chromium process and hang the test runner. */
async function withChatPage<T>(fn: (page: import("playwright").Page, workDir: string) => Promise<T>): Promise<T> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(CHAT_PAGE);
    return await fn(page, mkdtempSync(join(tmpdir(), "prodlens-session-")));
  } finally {
    await browser.close();
  }
}

test("a scripted session runs turn by turn and captures a transcript", async () => {
  await withChatPage(async (page, workDir) => {
    const res = await domChatSessionAdapter.execute(
      {
        op: "dom-chat",
        args: { turns: [{ speaker: "caller", text: "hello" }, { speaker: "caller", text: "second question" }] },
      },
      { surface: {}, page, workDir, manifest: SELECTORS },
    );

    assert.equal(res.ok, true, res.error);
    const artifact = res.artifacts?.find((a) => a.label === "transcript");
    assert.ok(artifact, "session should capture a transcript artifact");

    const { transcript } = JSON.parse(readFileSync(artifact.path, "utf-8"));
    // Each sent turn is followed by the product's reply, waited for rather than
    // slept past - and the UI's echo of our own message is not mistaken for it.
    assert.deepEqual(
      transcript.map((t: { speaker: string; text: string }) => `${t.speaker}: ${t.text}`),
      ["caller: hello", "product: echo: hello", "caller: second question", "product: echo: second question"],
    );
  });
});

test("a barge-in turn does not wait for the interrupted reply", async () => {
  await withChatPage(async (page, workDir) => {
    const res = await domChatSessionAdapter.execute(
      {
        op: "dom-chat",
        args: { turns: [{ speaker: "caller", text: "one", bargeIn: true }, { speaker: "caller", text: "two" }] },
      },
      { surface: {}, page, workDir, manifest: SELECTORS },
    );

    assert.equal(res.ok, true, res.error);
    const { transcript } = JSON.parse(readFileSync(res.artifacts![0].path, "utf-8"));
    // "one" is cut off, so no product reply is recorded between the two turns.
    assert.equal(transcript[0].text, "one");
    assert.equal(transcript[1].text, "two");
  });
});

test("the session op is adapter-declared, not known to core", () => {
  // Core resolves a session by asking adapters what they declare (spec §4.3),
  // so this op must be discoverable without core naming it.
  const declaring = listAdapters().filter(
    (a) => a.primitives.some((p) => p.op === "dom-chat") || a.sceneTypes.some((s) => s.id === "dom-chat"),
  );
  assert.equal(declaring.length, 1);
  assert.equal(declaring[0].id, "session-dom-chat");
});

test("the reference adapter never auto-claims a product surface", () => {
  // A real product's adapter must win selection over the reference driver.
  assert.equal(domChatSessionAdapter.detect({}), false);
});

test("an unknown op is refused rather than silently succeeding", async () => {
  const res = await domChatSessionAdapter.execute(
    { op: "voice-call", args: {} },
    { surface: {}, workDir: mkdtempSync(join(tmpdir(), "prodlens-session-")), manifest: {} },
  );
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /unknown op/);
});
