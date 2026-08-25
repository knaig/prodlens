// Spec: v2 §4.3, §9 V2 - see spec/traceability.md
// Verifies VoicEra's adapter (voicera_mono_repository/prodlens/adapter.mjs)
// against a stand-in for the real browser test dialog: same WebSocket protocol,
// same control labels, same transcript rendering. This is what makes the voice
// session testable with no :7860 / STT / TTS backend running.
//
// The test is skipped when the voicera checkout is not present, so this repo
// stays self-contained.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ADAPTER =
  process.env.VOICERA_ADAPTER ??
  "/Users/karthiknaig/Projects/voicera_mono_repository/prodlens/adapter.mjs";

// Stands in for test-browser-dialog.tsx: it speaks the same frames (start,
// media in; playAudio, transcript out) and exposes the same button labels.
const DIALOG_PAGE = `
<!doctype html><meta charset="utf-8">
<button id="start">Start Browser Test</button>
<button id="unmute" disabled>Unmute</button>
<button id="end" disabled hidden>End Session</button>
<ul id="transcripts"></ul>
<script>
  let ws = null, muted = true;
  const log = document.getElementById('transcripts');
  document.getElementById('start').onclick = () => {
    ws = new WebSocket('ws://localhost:7860/browser/agent/agent-123');
    ws.onopen = () => {
      muted = true;
      ws.send(JSON.stringify({ event: 'start', start: { callSid: 'sid-1', streamSid: 'sid-1' } }));
      document.getElementById('start').hidden = true;
      document.getElementById('unmute').disabled = false;
      const end = document.getElementById('end');
      end.hidden = false; end.disabled = false;
      // Mic frames, as the real dialog's ScriptProcessor would produce them.
      window.__micTimer = setInterval(() => {
        if (!ws || ws.readyState !== 1 || muted) return;
        ws.send(JSON.stringify({ event: 'media', media: { contentType: 'audio/x-l16', sampleRate: 16000, payload: 'AAAA' } }));
      }, 50);
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.event === 'transcript' && msg.content) {
        const li = document.createElement('li');
        li.dataset.role = msg.role; li.textContent = msg.content; log.appendChild(li);
      } else if (msg.event === 'playAudio') {
        window.__playedAudio = (window.__playedAudio || 0) + 1;
      }
    };
  };
  document.getElementById('unmute').onclick = () => { muted = false; };
  document.getElementById('end').onclick = () => { clearInterval(window.__micTimer); ws && ws.close(); };
</script>`;

const TURNS = [
  { speaker: "agent", text: "Namaste, VoicEra se bol rahe hain." },
  { speaker: "caller", text: "Mujhe apna balance jaanna hai." },
  { speaker: "agent", text: "Zaroor, ek pal." },
];

describe("voicera adapter", { skip: existsSync(ADAPTER) ? false : "voicera checkout not present" }, () => {
  async function runSession(turns: unknown[], manifest: Record<string, unknown> = {}) {
    const { voiceraAdapter } = await import(pathToFileURL(ADAPTER).href);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(DIALOG_PAGE);
      const workDir = mkdtempSync(join(tmpdir(), "voicera-session-"));
      const res = await voiceraAdapter.execute(
        { op: "voice-call", args: { turns } },
        { surface: {}, page, workDir, manifest: { voicera: { turnMs: 120, ...manifest } } },
      );
      const played = await page.evaluate("window.__playedAudio || 0");
      const rendered = await page.locator("#transcripts li").allInnerTexts();
      return { res, played, rendered };
    } finally {
      await browser.close();
    }
  }

  test("drives the dialog's real protocol and captures the transcript", async () => {
    const { res, rendered } = await runSession(TURNS);
    assert.equal(res.ok, true, res.error);

    // The dialog rendered every scripted line, in order - so the frames the
    // adapter emitted were shaped the way the dialog actually parses.
    assert.deepEqual(rendered, TURNS.map((t) => t.text));

    const transcript = res.artifacts.find((a: { label: string }) => a.label === "transcript");
    const parsed = JSON.parse(readFileSync(transcript.path, "utf-8"));
    assert.match(parsed.url, /\/browser\/agent\//);
    assert.deepEqual(
      parsed.transcript.map((t: { role: string }) => t.role),
      ["assistant", "user", "assistant"],
    );
  });

  test("the dialog really opens the stream and sends mic audio", async () => {
    const { res } = await runSession(TURNS);
    const frames = JSON.parse(
      readFileSync(res.artifacts.find((a: { label: string }) => a.label === "frames").path, "utf-8"),
    );
    // A session that silently no-ops would still return ok without these.
    assert.equal(frames.events[0], "start");
    assert.ok(frames.events.includes("media"), "unmuting should produce mic frames");
  });

  test("agent audio is played back when supplied", async () => {
    // A 44-byte header plus a little PCM, the shape wavToPayload expects.
    const wav = join(mkdtempSync(join(tmpdir(), "voicera-wav-")), "turn.wav");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(wav, Buffer.concat([Buffer.alloc(44), Buffer.alloc(320, 1)]));

    const { res, played } = await runSession(TURNS, { turnAudio: { t0: wav } });
    assert.equal(res.ok, true, res.error);
    assert.equal(played, 1, "the agent turn with audio should play exactly once");
  });

  test("a missing audio file degrades to transcript-only instead of failing", async () => {
    const { res, played } = await runSession(TURNS, { turnAudio: { t0: "/nonexistent/turn.wav" } });
    assert.equal(res.ok, true, res.error);
    assert.equal(played, 0);
  });

  test("an unknown op is refused", async () => {
    const { voiceraAdapter } = await import(pathToFileURL(ADAPTER).href);
    const res = await voiceraAdapter.execute(
      { op: "dom-chat", args: {} },
      { surface: {}, workDir: mkdtempSync(join(tmpdir(), "voicera-")), manifest: {} },
    );
    assert.equal(res.ok, false);
    assert.match(res.error, /unknown op/);
  });

  test("the live voice backends are not required for a scripted session", async () => {
    const { voiceraAdapter } = await import(pathToFileURL(ADAPTER).href);
    for (const resource of ["pipecat", "STT", "TTS"]) {
      const r = await voiceraAdapter.resolveResource({ resource, purpose: "run the call" }, {});
      assert.equal(r.status, "satisfied", `${resource} should not block a scripted session`);
    }
  });

  test("loading it registers it where the renderer actually looks", async () => {
    // Regression: the adapter imports the SDK by path (the built dist/ entry),
    // which is a different module instance from the src/ one the renderer runs
    // under tsx. When the registry lived in module scope there were two of
    // them - the adapter registered into one, render.ts searched the other, and
    // every session scene was skipped as "no adapter declares this op" even
    // though the adapter had loaded fine. Nothing catches that except this:
    // execute()-only tests bypass the registry entirely.
    const { loadExternalAdapter, listAdapters } = await import("./engine.js");
    await loadExternalAdapter(ADAPTER);
    const declaring = listAdapters().filter(
      (a) => a.primitives.some((p) => p.op === "voice-call") || a.sceneTypes.some((s) => s.id === "voice-call"),
    );
    assert.equal(declaring.length, 1, "voice-call must resolve to exactly one registered adapter");
    assert.equal(declaring[0].id, "voicera");
  });

  test("it declares the session op so core can resolve it without naming it", async () => {
    const { voiceraAdapter } = await import(pathToFileURL(ADAPTER).href);
    assert.ok(
      voiceraAdapter.primitives.some((p: { op: string }) => p.op === "voice-call") ||
        voiceraAdapter.sceneTypes.some((s: { id: string }) => s.id === "voice-call"),
    );
    assert.equal(voiceraAdapter.detect({ description: "VoicEra voice agents" }), true);
    assert.equal(voiceraAdapter.detect({ description: "some unrelated app" }), false);
  });
});
