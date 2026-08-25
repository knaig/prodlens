// Product demo videos - live click-through mode. Unlike an explainer (still
// screenshots + narration), a demo RECORDS the real session: Playwright's
// recordVideo captures actual cursor motion, typing, hover states, and screen
// transitions into one continuous video, then each step's narration (Gemini
// TTS, local Kokoro, or any --tts-cmd) is mixed onto the recorded timeline at
// the moment it happened. Each screen is scrolled through live so the video
// shows the full page. The same run also emits a silent video + a timestamped
// screenplay (what to say and when) for voice-over re-recording.
//
// Optionally a vision-capable LLM (e.g. qwen-vl via an OpenAI-compatible
// endpoint) drives the walkthrough (guided mode) or writes narration lines
// for screens the script didn't pre-write (auto-narrate).
import { chromium, type Page } from "playwright";
import { execFile } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import { getAuthedContext, type AuthConfig } from "../discovery/auth.js";
import { startDesktopCapture } from "./capture.js";
import { synthNarration, probeDuration } from "./explain.js";
import { localChat, llmBaseUrl, llmVisionModel } from "../llm/local.js";
import { viewportToScreen, osHumanClick, osScroll, osMove, osType, activatePlaywrightBrowser, makeWindowFullscreen, addStopControl, exposeStopRelease, pageStopRequested, readWindowGeometry, lockCursorToWindow, addCursorOverlay, announceTakeover, confirmScreenCapture, type WindowGeometry, type CursorLock } from "./os-cursor.js";
import type { Edge, GraphVersion, PrioritizedPath } from "../types.js";

export interface DemoStep {
  name: string;
  narrate?: string;
  goto?: string;
  fill?: Record<string, string>;
  click?: string;
  selector?: string;
  /** A branch the app may or may not show: on failure the step is skipped
   *  (logged), never aborting the demo. */
  optional?: boolean;
  /** How long the click target may take to appear (default 8000ms). Raise for
   *  screens gated on slow work, e.g. a model call rendering the next button. */
  clickTimeoutMs?: number;
  /** Click at exact viewport coordinates (LLM-supplied). */
  pointer?: { x: number; y: number };
  /** How long to scroll the page during this step: "down" (top->bottom and
   *  stop), "tour" (down->up so the full page is seen), or false to skip. */
  scroll?: "down" | "tour" | false;
  settleMs?: number;
  /** An interactive session driven by something outside this renderer (spec
   *  §4.3). demo.ts knows nothing about what a session IS - it hands the live
   *  page to opts.onSession and waits. That is what keeps the transport (voice
   *  over WebSocket, chat over DOM, video over WebRTC) out of core. */
  session?: SessionRequest;
}

/** What a session step asks for. `kind` names an op the caller's adapter
 *  declares; `turns` is the scripted conversation. `id` identifies the scene so
 *  the caller can file the session's artifacts under it. */
export interface SessionRequest {
  id: string;
  kind: string;
  turns: Array<{ speaker: string; text?: string; bargeIn?: boolean }>;
}

export interface DemoIntro {
  /** Title shown as a burn-in card at the start (e.g. the product name). */
  title?: string;
  /** One-line value prop shown under the title. */
  tagline?: string;
  /** Narration spoken over the intro card. */
  narrate?: string;
}

export interface DemoScript {
  title?: string;
  baseUrl: string;
  entry?: string;
  viewport?: { width: number; height: number };
  voice?: string;
  /** A short value-prop line used for the intro card + screenplay header. */
  valueProp?: string;
  intro?: DemoIntro;
  /** When true, a vision LLM reads each live screenshot and proposes the next
   *  action + narration line (guided mode). Steps are ignored except as hints. */
  guided?: boolean;
  /** Show a DOM overlay cursor (default true) so the recorded video and the
   *  screenshots the vision LLM reads both show a real pointer. */
  cursor?: boolean;
  /** When true, missing `narrate` lines are written by the vision LLM from the
   *  live screenshot (default true when an LLM endpoint is configured). */
  autoNarrate?: boolean;
  /** Scroll behavior for steps that don't specify one (default "tour"). */
  scroll?: "down" | "tour" | false;
  /** Feed this WAV as the fake microphone (real in-browser call scenes):
   *  Chromium is launched with fake-device flags and this capture file, and
   *  getUserMedia is auto-granted. */
  fakeMicWav?: string;
  /** OpenAI-compatible endpoint for guided/auto-narration (default from env). */
  llmBaseUrl?: string;
  llmModel?: string;
  /** Intercept in-app API calls during recording and return a stubbed response.
   *  Keys are URL substrings (e.g. "/api/outbound-call"); values are the JSON
   *  body to return with a 200. Lets a demo show a full success flow even when
   *  a backend service (like the telephony voice server) isn't reachable. */
  mockRoutes?: Record<string, unknown>;
  /** Intercept WebSockets during recording and simulate the server, so a demo
   *  can show a live in-browser voice conversation without a real backend.
   *  Each entry matches a WS URL substring (e.g. "/browser/agent/"); when a
   *  page opens a matching socket, prodlens answers in place of the server and
   *  plays back the given event script with the configured delays. This is how
   *  the voicera "Test on Browser" dialog (audio/x-l16 PCM + transcript
   *  events) runs end-to-end with no phone number or telephony provider. */
  mockWebSockets?: MockWebSocket[];
  /** Closing card + narration delivered after the final step, so the video ends
   *  on a hold screen and fades out instead of cutting straight off the last
   *  step. Like `intro`, its `narrate` line is spoken over the last screen. */
  outro?: DemoIntro;
  steps: DemoStep[];
}

export interface MockWebSocketEvent {
  /** ms of silence to wait after the previous event's audio finishes (or after
   *  connection, for the first event) before this one starts. */
  delayMs?: number;
  /** The event payload to send to the page, JSON-encoded. For a transcript
   *  turn: { event: "transcript", role: "assistant", content: "..." }. */
  message: Record<string, unknown>;
  /** When true (and the message is a transcript with content), the line is
   *  spoken aloud: synthesized via the demo TTS before recording, delivered to
   *  the page as a playAudio frame (so the orb/level animates live), and the
   *  audio mixed onto the recorded timeline at the moment the event fires -
   *  giving the "voice conversation" actual audible speech in the video. */
  speak?: boolean;
  /** TTS voice for this spoken line (defaults to the script video). */
  speakVoice?: string;
  /** Cut this spoken line's audio short at this many seconds into it (e.g. 2.3)
   *  so the speaker is caught mid-word - a genuine barge-in. The interruptor's
   *  delayMs then lands right at the cut point: the previous voice stops and
   *  the new one starts, instead of both playing out in turn. */
  speakCutAtSec?: number;
  /** A narrator setup line spoken OVER the video at this point in the mock
   *  timeline (e.g. "Now the caller interrupts mid-sentence"). It is synthesized
   *  with the main narrator voice, mixed onto the timeline, and the script HOLDS
   *  for its duration so the conversation snippet that follows never overlaps
   *  the voiceover. It is not delivered to the page. */
  narrate?: string;
}

export interface MockWebSocket {
  /** URL substring to match (e.g. "/browser/agent/"). */
  url: string;
  /** Event script to play after the socket connects. */
  script: MockWebSocketEvent[];
}

export interface DemoOptions {
  auth: AuthConfig;
  screenshotsDir: string;
  scale?: string;
  voice?: string;
  settleMs?: number;
  ttsCmd?: string;
  /** Disable the narrated (voiced) video - emit silent + screenplay only. */
  noVoice?: boolean;
  /** Disable burning captions into the video. */
  noCaptions?: boolean;
  /** Drive the REAL OS cursor via cliclick and record the screen (AVFoundation)
   *  instead of Playwright's in-page recording + DOM overlay. The pointer in
   *  the video is the actual OS cursor. Requires the app window to stay
   *  frontmost during recording. */
  osCursor?: boolean;
  /** Runs a DemoStep.session against the live recording page. Supplied by the
   *  caller (studio/render.ts routes it to the product's adapter) so this
   *  renderer never learns a product's transport. Throwing skips the step the
   *  same way any other step failure does. */
  onSession?: (page: import("playwright").Page, session: SessionRequest) => Promise<void>;
}

export interface DemoScreenplayScene {
  atSec: number;
  durSec: number;
  name: string;
  action?: string;
  narrate?: string;
}

export interface DemoScreenplay {
  title?: string;
  valueProp?: string;
  baseUrl: string;
  createdAt: string;
  totalSec: number;
  scene: DemoScreenplayScene[];
}

export interface DemoResult {
  videoPath: string;
  /** The same recording with narration muted - for voice-over re-recording. */
  silentVideoPath?: string;
  screenplayPath?: string;
  screenplayMdPath?: string;
  narratedClips: number;
  stepsRun: number;
  error?: string;
}

const LLM_BASE = llmBaseUrl();
const DEFAULT_LLM = llmVisionModel();

/** Active OS-cursor mode for the current render - set by renderProductDemo and
 *  read by humanClick/scrollPage so they drive the real pointer (cliclick) when
 *  active. Isolated per process (CLI runs one demo at a time). */
let osCursorMode: { geom: WindowGeometry } | undefined;

/** Translate a viewport point to a real screen point when in OS-cursor mode. */
function screenPoint(x: number, y: number): { x: number; y: number } {
  if (!osCursorMode) return { x, y };
  return viewportToScreen(osCursorMode.geom, x, y);
}

/** SVG pointer injected into every page so recordVideo (and the vision LLM's
  *  screenshots) show a real cursor. Tracks mouse events via an init script, so
  *  it survives full navigations. pointer-events:none keeps the overlay inert. */

/** Move the mouse to an element's center with a visible glide, dwell, then
 *  click - so the recording shows a human pointer, not a jump + instant hit.
 *  In OS-cursor mode this drives the REAL cursor via cliclick at translated
 *  screen coordinates. */
async function humanClick(page: Page, x: number, y: number): Promise<void> {
  if (osCursorMode) {
    const s = viewportToScreen(osCursorMode.geom, x, y);
    await osHumanClick(s.x, s.y);
    return;
  }
  await page.mouse.move(x, y, { steps: 24 });
  await page.waitForTimeout(140);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(120);
}

/** Center of a visible locator, or null if not found/visible. */
async function elementCenter(page: Page, locator: import("playwright").Locator): Promise<{ x: number; y: number } | null> {
  // boundingBox() is viewport-relative: after a scroll step an off-screen
  // element yields coordinates the mouse can't hit, so the humanClick
  // silently no-ops and the demo drifts one screen behind its script.
  // Bring the element into view first - like a human would.
  await locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => null);
  const box = await locator.boundingBox().catch(() => null);
  if (!box || box.width === 0 || box.height === 0) return null;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Scroll the current page through so the recording shows the whole screen.
 *  "tour" goes down then back up (full page visible); "down" goes to the
 *  bottom and stays. Uses real mouse wheel events so the video shows natural
 *  scroll motion. In OS-cursor mode the real pointer parks over the content
 *  while the page scrolls under it (how a human scrolls). */
async function scrollPage(page: Page, mode: "down" | "tour"): Promise<void> {
  const scrollable = await page
    .evaluate(() => {
      const de = document.documentElement;
      return de.scrollHeight > de.clientHeight + 40;
    })
    .catch(() => false);
  if (!scrollable) return;

  if (osCursorMode) {
    await osScroll(page, osCursorMode.geom, mode);
    return;
  }

  const step = 320;
  const pauseMs = 60;
  let y = 0;
  const maxY = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight).catch(() => 0);

  const scrollDown = async () => {
    while (y < maxY - 20) {
      await page.mouse.wheel(0, step);
      y += step;
      await page.waitForTimeout(pauseMs);
    }
  };
  await scrollDown();
  await page.waitForTimeout(250);
  if (mode === "tour") {
    while (y > 0) {
      await page.mouse.wheel(0, -step);
      y -= step;
      await page.waitForTimeout(pauseMs);
    }
    await page.waitForTimeout(150);
  }
}

/** Drive a scripted or guided walkthrough in a real (headed) browser, record it
 *  as one continuous video, scroll each screen through, mix per-step narration
 *  onto the timeline, and emit a silent twin + timestamped screenplay.
 *  Returns the output MP4 path. Requires ffmpeg + ffprobe. */
/** Whether this script needs Chromium's fake audio device. A browser voice or
 *  session UI calls getUserMedia BEFORE it opens its transport, so without this
 *  the dialog never reaches its socket and the failure surfaces far away as
 *  "the session never finished" rather than "permission denied". */
export function needsFakeMedia(script: Pick<DemoScript, "mockWebSockets" | "fakeMicWav" | "steps">): boolean {
  return Boolean(script.mockWebSockets?.length || script.fakeMicWav || script.steps.some((s) => s.session));
}

export async function renderProductDemo(script: DemoScript, outPath: string, opts: DemoOptions): Promise<DemoResult> {
  mkdirSync(dirname(outPath), { recursive: true });
  const staging = `${dirname(outPath)}/.demo-${basename(outPath)}-${process.pid}`;
  mkdirSync(staging, { recursive: true });

  const voice = opts.voice ?? script.voice ?? process.env.GEMINI_API_KEY ? "Kore" : "Samantha";
  const ttsCmd = opts.ttsCmd ?? "";

  // Pre-synthesize ALL scripted narration (and the intro line) before the
  // recording starts. TTS latency never enters the recorded timeline this way:
  // the video is just the walkthrough, and each clip is later mixed at its
  // screen-ready timestamp. A failed clip degrades to no narration for that
  // step rather than failing the whole demo.
  const stagingDir = dirname(outPath);
  mkdirSync(stagingDir, { recursive: true });
  const preSynthDir = `${stagingDir}/.presynth-${basename(outPath)}-${process.pid}`;
  mkdirSync(preSynthDir, { recursive: true });
  const introFile = script.intro?.narrate ? join(preSynthDir, "narr-intro.wav") : undefined;
  const preSynth: (string | undefined)[] = new Array(script.steps.length).fill(undefined);
  const preSynthDur: number[] = new Array(script.steps.length).fill(0);
  let introDurSec = 0;
  if (introFile && script.intro?.narrate) {
    await synthNarration(script.intro.narrate, voice, 180, ttsCmd, introFile).catch(() => null);
    if (existsSync(introFile)) introDurSec = await probeDuration(introFile).catch(() => 0);
  }
  for (let i = 0; i < script.steps.length; i++) {
    if (!script.steps[i].narrate) continue;
    preSynth[i] = join(preSynthDir, `narr-${String(i).padStart(3, "0")}.wav`);
    // Retry transient TTS failures (e.g. Gemini rate limits) a few times with
    // a small backoff - a demo that silently loses half its narration is worse
    // than a slightly slower one. Only give up permanently on persistent errors.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await synthNarration(script.steps[i].narrate!, voice, 180, ttsCmd, preSynth[i]!);
        break;
      } catch (e) {
        if (attempt === 3) {
          console.warn(`Narration synthesis failed for step "${script.steps[i].name}" after 3 attempts: ${e instanceof Error ? e.message : String(e)}`);
          preSynth[i] = undefined;
        } else {
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
    }
    if (preSynth[i]) preSynthDur[i] = await probeDuration(preSynth[i]!).catch(() => 0);
  }

  // Pre-synthesize the outro line (spoken over the final hold screen).
  const outroFile = script.outro?.narrate ? join(preSynthDir, "narr-outro.wav") : undefined;
  let outroDurSec = 0;
  if (outroFile) {
    await synthNarration(script.outro!.narrate!, voice, 180, ttsCmd, outroFile).catch(() => null);
    if (existsSync(outroFile)) outroDurSec = await probeDuration(outroFile).catch(() => 0);
  }

  // Pre-synthesize spoken mock-WS conversation lines AND narrator setups. Each
  // typed `speak` transcript becomes a WAV here (so TTS latency never enters the
  // recorded timeline); each `narrate` setup line becomes a separate WAV spoken
  // with the narrator's voice. Lines with speakCutAtSec are truncated mid-word
  // to simulate a caller barging in. Layout mirrors
  // script.mockWebSockets[i].script[j].
  type SpeakPre = { file: string; durSec: number; pcmBase64?: string } | undefined;
  const speakClips: (SpeakPre | undefined)[][] = script.mockWebSockets?.length
    ? await Promise.all(
        script.mockWebSockets.map(async (mock, mi) =>
          Promise.all(
            mock.script.map(async (ev, ei) => {
              if (ev.narrate) {
                const file = join(preSynthDir, `snarr-${mi}-${ei}.wav`);
                await synthNarration(ev.narrate, voice, 180, ttsCmd, file).catch(() => null);
                if (!existsSync(file)) return undefined;
                return { file, durSec: await probeDuration(file).catch(() => 0) };
              }
              if (!ev.speak || !ev.message?.content || typeof ev.message.content !== "string") return undefined;
              const file = join(preSynthDir, `speak-${mi}-${ei}.wav`);
              let ok = false;
              for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
                try {
                  await synthNarration(String(ev.message.content), ev.speakVoice ?? voice, 180, ttsCmd, file);
                  ok = true;
                } catch (e) {
                  if (attempt === 3) console.warn(`Conversation line synthesis failed for mock ${mi} event ${ei}: ${e instanceof Error ? e.message : String(e)}`);
                  else await new Promise((r) => setTimeout(r, 1500 * attempt));
                }
              }
              if (!ok || !existsSync(file)) return undefined;
              // True barge-in: truncate this line mid-word, then convert.
              if (ev.speakCutAtSec) {
                const cut = `${preSynthDir}/speakcut-${mi}-${ei}.wav`;
                await runFfmpeg(["-y", "-i", file, "-t", String(Math.max(0.3, ev.speakCutAtSec)), "-c", "copy", cut]).catch(() => null);
                if (existsSync(cut) && (await probeDuration(cut).catch(() => 0)) > 0.1) {
                  rmSync(file, { force: true });
                  return { file: cut, durSec: await probeDuration(cut).catch(() => 0) };
                }
              }
              return { file, durSec: await probeDuration(file).catch(() => 0) };
            })
          )
        )
      )
    : [];

  const browser = await chromium.launch({
    headless: false,
    // Browser voice/session UIs call getUserMedia before they open their
    // transport; grant a fake audio device so the session starts without a real
    // mic. A fakeMicWav additionally feeds a real capture file as the
    // "microphone" so call scenes can speak a prerecorded utterance.
    //
    // Session steps need this too: a product's dialog that cannot get a mic
    // never reaches its socket, and the failure surfaces far away as "the
    // session never finished" rather than "permission denied".
    args:
      needsFakeMedia(script)
        ? [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            ...(script.fakeMicWav ? [`--use-file-for-fake-audio-capture=${script.fakeMicWav}`] : []),
          ]
        : [],
  });
  const narrated: { file: string; atSec: number; durSec: number }[] = [];
  const scenes: DemoScreenplayScene[] = [];
  let stepsRun = 0;
  let error: string | undefined;
  let cursorLock: CursorLock | undefined;

  try {
    // Pre-warm every route the walkthrough will visit (entry + all goto
    // targets) so Next.js compiles them BEFORE the recording starts. Without
    // this, the first visit to each screen spends seconds on a dev-server
    // compile, and the narration (correctly waiting for the screen to render)
    // leaves the viewer staring at a blank page. Done in a SEPARATE, auth'd,
    // UNRECORDED context that is closed before recording begins - so warming
    // footage never enters the video and t0 (anchored right after) aligns with
    // the true video start. Its login also populates the shared storageState
    // the recording context then reuses.
    const warmUrls = new Set<string>([`${baseUrl(script)}${script.entry ?? "/"}`]);
    if (!script.guided) {
      for (const s of script.steps) {
        if (s.goto) warmUrls.add(`${baseUrl(script)}${s.goto.split("?")[0].split("#")[0]}`);
      }
    }
    const warmContext = await getAuthedContext(browser, opts.auth);
    const warmPage = await warmContext.newPage();
    if (script.viewport) await warmPage.setViewportSize(script.viewport);
    for (const url of warmUrls) {
      await warmPage.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => null);
      await warmPage.waitForTimeout(600);
    }
    await warmContext.close();

    // Now create the recording context. With --os-cursor the video is the real
    // screen (captured via AVFoundation, real cursor) recorded concurrently
    // while the walkthrough drives the actual pointer; otherwise Playwright's
    // in-page recordVideo captures the DOM-overlay cursor as before.
    const recordStart = Date.now();
    let osCursor = opts.osCursor;
    let osScreenCapture: ReturnType<typeof startDesktopCapture> | undefined;
    let windowGeom: WindowGeometry | undefined;

    const context = await getAuthedContext(browser, opts.auth, osCursor ? {} : {
      recordVideo: { dir: staging, size: script.viewport ?? { width: 1280, height: 800 } },
    });
    // In-browser voice tests (voicera "Test on Browser") open the mic via
    // getUserMedia - grant it so the WebSocket session can start without a
    // permission prompt interrupting the recording.
    if (script.mockWebSockets?.length || script.fakeMicWav) {
      await context.grantPermissions(["microphone"], { origin: baseUrl(script) }).catch(() => null);
    }
    if (script.cursor !== false && !osCursor) await addCursorOverlay(context);
    const page = await context.newPage();
    if (script.viewport) await page.setViewportSize(script.viewport);
    // Stub configured in-app API routes so the demo can show success flows even
    // when a backend dependency (telephony, LLM, storage) isn't reachable.
    if (script.mockRoutes) {
      const mocks = Object.entries(script.mockRoutes);
      for (const [substr, body] of mocks) {
        await page.route(`**/*${substr}*`, (route) =>
          route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
        );
      }
    }
    // Simulate WebSocket servers (e.g. the voicera browser voice test) so a
    // demo can show a live in-browser conversation without a real backend.
    if (script.mockWebSockets?.length) {
      // Pre-encode each spoken line's WAV to raw 16kHz mono PCM16; the page
      // accepts that exact format (playAudio, audio/x-l16). Done once, at the
      // top of the handler per event, so frame delivery stays gapless.
      const pcmCache = new Map<string, string>();
      const wavToPcm16Base64 = async (wavPath: string): Promise<string | undefined> => {
        const hit = pcmCache.get(wavPath);
        if (hit !== undefined) return hit;
        const out = join(staging, `pcm-${basename(wavPath).replace(/\.wav$/, "")}.s16`);
        try {
          await runFfmpeg(["-y", "-i", wavPath, "-ar", "16000", "-ac", "1", "-f", "s16le", out]);
          const bytes = (await import("node:fs")).readFileSync(out);
          const b64 = bytes.toString("base64");
          pcmCache.set(wavPath, b64);
          rmSync(out, { force: true });
          return b64;
        } catch {
          return undefined;
        }
      };
      for (const [mi, mock] of script.mockWebSockets.entries()) {
        const urlPattern = `**/*${mock.url}*`;
        await context.routeWebSocket(urlPattern, async (ws) => {
          for (const [ei, ev] of mock.script.entries()) {
            const clip = speakClips[mi]?.[ei];
            // Narrator setup: a voiceover mixed over the video, not delivered to
            // the page. Played BEFORE this snippet so the two never overlap; the
            // video's narration track carries it, the browser just holds.
            if (ev.narrate && clip) {
              const atSec = (Date.now() - t0) / 1000;
              narrated.push({ file: clip.file, atSec, durSec: clip.durSec });
              // Hold out the voiceover here AND raise the narration cursor so a
              // later step's voice (e.g. End the session) never starts over the
              // still-playing call.
              if (cursorSec < atSec + clip.durSec + 0.4) cursorSec = atSec + clip.durSec + 0.4;
              const holdMs = Math.round((clip.durSec + 0.35) * 1000);
              await page.waitForTimeout(holdMs).catch(() => null);
              continue;
            }
            if (ev.delayMs) await page.waitForTimeout(ev.delayMs);
            if (clip) {
              const b64 = await wavToPcm16Base64(clip.file);
              if (b64) {
                try {
                  await ws.send(
                    JSON.stringify({
                      event: "playAudio",
                      media: { contentType: "audio/x-l16", sampleRate: 16000, payload: b64 },
                    })
                  );
                } catch {
                  break;
                }
                // Mix the same line onto the recorded timeline at the moment the
                // event fires, so the "voice conversation" is audible in the video.
                const atSec = (Date.now() - t0) / 1000;
                narrated.push({ file: clip.file, atSec, durSec: clip.durSec });
                if (cursorSec < atSec + clip.durSec + 0.4) cursorSec = atSec + clip.durSec + 0.4;
              }
            }
            try {
              ws.send(JSON.stringify(ev.message));
            } catch {
              break; // socket closed (e.g. End Session clicked) - stop the script
            }
          }
        });
      }
    }

    if (osCursor) {
      // EXPLICIT CONSENT is required before any screen recording starts. If
      // declined (or not a TTY), fall back to the DOM-overlay + in-page
      // recording instead of capturing the screen without permission.
      const ok = await confirmScreenCapture("The demo");
      if (!ok) {
        console.warn("[prodlens] Screen capture not consented - falling back to DOM-overlay recording (no screen capture).");
        osCursor = false;
        osCursorMode = undefined;
        if (script.cursor !== false) await addCursorOverlay(context);
      } else {
        // Bring the launched browser (Playwright's Chromium) forward - NOT the
        // operator's real browser - and read its on-screen geometry so viewport
        // coords can be translated to real screen coords for cliclick.
        const activeBundle = await activatePlaywrightBrowser(browser).catch(() => undefined);
        // Size the recording window to the main display (CDP) so nothing
        // overlays it, and add an in-page Stop button (mouse is locked here).
        await makeWindowFullscreen(page).catch(() => null);
        await addStopControl(context);
        windowGeom = await readWindowGeometry(page).catch(() => undefined);
        if (!windowGeom) throw new Error("os-cursor: could not read window geometry - is the browser window visible?");
        osCursorMode = { geom: windowGeom };
        // Tell the operator we're taking the mouse, then lock it inside the app
        // window so they can't wander it mid-recording. Released in finally (and
        // failsafe after 10min) - never an infinite lock. Press Enter/Esc/X/Q to
        // abort at any time.
        await announceTakeover("prodlens demo").catch(() => null);
        cursorLock = lockCursorToWindow(windowGeom, { maxMs: 10 * 60 * 1000, appBundleId: activeBundle ?? "com.google.chrome.for.testing" });
        // Expose release to the in-page Stop button.
        await exposeStopRelease(page, () => cursorLock?.release());
        // Start recording the real screen (with the real cursor) BEFORE t0.
        osScreenCapture = startDesktopCapture(join(staging, "screen.mp4"), { framerate: 30, deviceIndex: 2 });
        await new Promise((r) => setTimeout(r, 600)); // let ffmpeg open the device
      }
    }

    const t0 = Date.now();

    await page.goto(`${script.baseUrl}${script.entry ?? "/"}`, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => null);
    await page.waitForTimeout(900);

    const autoNarrate = script.autoNarrate ?? true;
    const llmBase = script.llmBaseUrl ?? LLM_BASE;
    const llmModel = script.llmModel ?? DEFAULT_LLM;

    // Narration cursor (seconds relative to t0): no clip may start before the
    // previous one ends, so clips never overlap. The intro owns the opening.
    let cursorSec = 0;
    // Real recorded-footage floor for the end trim (below) - updated after
    // every step's hold, whether or not that step's narration succeeded, so a
    // trailing step with failed TTS never gets its actual footage chopped off.
    let lastRecordedSec = 0;
    if (introFile && (await existsSync(introFile))) {
      narrated.push({ file: introFile, atSec: 0.3, durSec: introDurSec });
      cursorSec = 0.3 + introDurSec + 0.4;
    }

    if (script.guided) {
      const guided = await runGuidedSession(page, script, opts, staging, t0, voice, ttsCmd, narrated, scenes, cursorSec);
      stepsRun = guided.stepsRun;
      error = guided.error;
    } else {
      for (let i = 0; i < script.steps.length; i++) {
        // Manual override: abort key or in-page Stop button - stop now.
        const stopHit = cursorLock?.aborted || (osCursor ? await pageStopRequested(page).catch(() => false) : false);
        if (stopHit) {
          error = "Aborted by operator (abort key / in-page Stop) - partial demo saved.";
          break;
        }
        const step = script.steps[i];
        const actionDesc = describeStepAction(step);
        try {
          await runStep(page, baseUrl(script), step);
          if (step.session) {
            if (!opts.onSession) throw new Error(`step "${step.name}" needs a session (${step.session.kind}) but no session handler was supplied`);
            await opts.onSession(page, step.session);
          }
        } catch (e) {
          // An optional step is a branch the app may or may not show (e.g. a
          // confirm panel that only appears sometimes) - skip it, keep going.
          if (step.optional) {
            console.log(`(optional step "${step.name}" skipped: ${e instanceof Error ? e.message : String(e)})`);
            continue;
          }
          error = `Step "${step.name}" failed: ${e instanceof Error ? e.message : String(e)}`;
          await page.waitForTimeout(200);
          break;
        }
        // Adaptive settle: wait for the network to go quiet (the new screen's
        // data fetch actually finishing) instead of a flat sleep - a fast
        // screen resolves almost immediately, a slow one still gets up to the
        // ceiling below. settleMs/opts.settleMs is now that ceiling, not a
        // fixed wait every screen pays regardless of how fast it rendered.
        await page.waitForLoadState("networkidle", { timeout: step.settleMs ?? opts.settleMs ?? 3000 }).catch(() => null);
        const screenReadySec = (Date.now() - t0) / 1000;

        let narrate = step.narrate;
        let audioFile = preSynth[i];
        let clipDurSec = preSynthDur[i];
        // Auto-narrate only when the script omitted a line entirely (undefined);
        // an explicit empty string means "this step is silent - do not narrate".
        if (narrate === undefined && autoNarrate) {
          const shot = join(staging, `auto-${String(i).padStart(3, "0")}.png`);
          await page.screenshot({ path: shot, fullPage: false }).catch(() => null);
          narrate = await describeScreen(shot, step.name, llmBase, llmModel);
          if (narrate) {
            audioFile = join(staging, `narr-${String(i).padStart(3, "0")}.wav`);
            await synthNarration(narrate, voice, 180, ttsCmd, audioFile).catch(() => {
              audioFile = undefined;
            });
            if (audioFile && existsSync(audioFile)) clipDurSec = await probeDuration(audioFile).catch(() => 0);
          }
        }

        // The clip can't start before the previous one finishes; if the
        // previous voice is still playing, this screen just holds until it's
        // this screen's turn - no overlapping voices.
        const narrateAtSec = Math.max(screenReadySec, cursorSec);
        const remainingBefore = narrateAtSec - (Date.now() - t0) / 1000;
        if (remainingBefore > 0) await page.waitForTimeout(remainingBefore * 1000);

        if (audioFile && narrate) narrated.push({ file: audioFile, atSec: narrateAtSec, durSec: clipDurSec });
        if (clipDurSec) cursorSec = narrateAtSec + clipDurSec + 0.3;

        // Scroll WHILE the narration plays (it's anchored at narrateAtSec), so
        // the scroll motion never lands in a silent gap - the viewer sees the
        // full page under the voice instead of between clips.
        const scrollMode = step.scroll === undefined ? (script.scroll ?? "tour") : step.scroll;
        if (scrollMode) await scrollPage(page, scrollMode);

        // Hold this screen until its narration finishes so the next screen
        // doesn't appear mid-sentence; a 0.4s tail for a natural breath.
        const holdUntilSec = (audioFile && clipDurSec ? narrateAtSec + clipDurSec + 0.3 : (Date.now() - t0) / 1000 + 0.3);
        const remainingHold = holdUntilSec - (Date.now() - t0) / 1000;
        if (remainingHold > 0) await page.waitForTimeout(remainingHold * 1000);
        lastRecordedSec = holdUntilSec;

        scenes.push({ atSec: narrateAtSec, durSec: 0, name: step.name, action: actionDesc, narrate });
        stepsRun++;
      }
    }

    // Outro: deliver the closing line over the final screen, then let the video
    // fade out. Anchor it after the last step's narration finishes so the two
    // never overlap, and hold the (already recorded) screen until it's spoken.
    if (outroFile) {
      let narrate = script.outro?.narrate;
      const atSec = Math.max(cursorSec, (Date.now() - t0) / 1000 + 0.2);
      const remainingBefore = atSec - (Date.now() - t0) / 1000;
      if (remainingBefore > 0) await page.waitForTimeout(remainingBefore * 1000);
      narrated.push({ file: outroFile, atSec, durSec: outroDurSec });
      scenes.push({ atSec, durSec: 0, name: "Outro", action: "", narrate });
      const holdUntilSec = atSec + outroDurSec + 0.6;
      const remainingHold = holdUntilSec - (Date.now() - t0) / 1000;
      if (remainingHold > 0) await page.waitForTimeout(remainingHold * 1000);
      lastRecordedSec = holdUntilSec;
    }

    await page.waitForTimeout(400);
    let rawVideo: string | undefined;
    if (osCursor && osScreenCapture) {
      await osScreenCapture.stop();
      rawVideo = join(staging, "screen.mp4");
    } else {
      rawVideo = await page.video()?.path();
    }
    await context.close();
    osCursorMode = undefined;

    if (error) {
      await rmSync(staging, { recursive: true, force: true });
      return { videoPath: outPath, narratedClips: 0, stepsRun, error };
    }
    if (!rawVideo) throw new Error("No video was recorded (recordVideo requires a headed context).");

    // Narration timestamps were measured relative to t0 (set after login).
    // The video actually starts at context creation (recordStart, which for an
    // auth'd run includes the login flow), so shift every timestamp by the
    // lead time to land on the true video timeline.
    const shiftSec = Math.max(0, (t0 - recordStart) / 1000);
    for (const n of narrated) n.atSec += shiftSec;
    for (const sc of scenes) sc.atSec += shiftSec;
    if (lastRecordedSec) lastRecordedSec += shiftSec;

    const totalSec = await probeDuration(rawVideo);

    // Trim the video to end ~1.2s after the last narration clip finishes, so
    // the output never trails off into minutes of static silent screen. Floor
    // it at lastRecordedSec too - a step whose TTS failed still has real
    // recorded footage that `narrated` alone wouldn't account for, and
    // trimming to an earlier narrated clip would silently cut that off.
    const lastClipEnd = Math.max(
      lastRecordedSec,
      narrated.length ? Math.max(...narrated.map((n) => n.atSec + n.durSec)) : 0,
    ) || totalSec;
    // 2s tail after the last narration clip: enough for a TTS provider's own
    // trailing silence/fade to finish audibly instead of getting clipped.
    const endSec = Math.min(totalSec, lastClipEnd + 2);

    const screenplay = buildScreenplay(script, scenes, endSec);
    const captionStaging = await writeCaptionFiles(script, scenes, staging);

    const silentPath = opts.noVoice ? undefined : `${replaceExt(outPath, "")}silent.mp4`;
    const screenplayJsonPath = `${replaceExt(outPath, "")}screenplay.json`;
    const screenplayMdPath = `${replaceExt(outPath, "")}screenplay.md`;
    writeFileSync(screenplayJsonPath, JSON.stringify(screenplay, null, 2));
    writeFileSync(screenplayMdPath, renderScreenplayMd(screenplay));

    // For --os-cursor the raw video is a full-screen capture; crop to the app
    // window (capture pixels = points * dpr) so the output is just the app.
    const cropRect = osCursor && windowGeom
      ? {
          x: Math.round(windowGeom.screenX * windowGeom.dpr),
          y: Math.round(windowGeom.screenY * windowGeom.dpr),
          w: Math.round(windowGeom.outerW * windowGeom.dpr),
          h: Math.round(windowGeom.outerH * windowGeom.dpr),
        }
      : undefined;

    await renderVideo(rawVideo, narrated, scenes, captionStaging, outPath, opts.scale ?? "1280:-2", !opts.noVoice, !opts.noCaptions, endSec, cropRect);
    if (silentPath && !opts.noCaptions) {
      await renderVideo(rawVideo, [], scenes, captionStaging, silentPath, opts.scale ?? "1280:-2", false, true, endSec, cropRect);
    } else if (silentPath) {
      await renderVideo(rawVideo, [], scenes, [], silentPath, opts.scale ?? "1280:-2", false, false, endSec, cropRect);
    }

    return {
      videoPath: outPath,
      silentVideoPath: silentPath,
      screenplayPath: screenplayJsonPath,
      screenplayMdPath,
      narratedClips: narrated.length,
      stepsRun,
    };
  } finally {
    // Always release the cursor lock - on success, error, or any exit path.
    // The failsafe timer inside the lock also guarantees release, so this can
    // never leave the machine stuck with a captured pointer.
    if (cursorLock) cursorLock.release();
    await browser.close();
    rmSync(staging, { recursive: true, force: true });
    rmSync(preSynthDir, { recursive: true, force: true });
  }
}

function replaceExt(path: string, _ext: string): string {
  return path.replace(/\.[a-zA-Z0-9]+$/, "") + ".";
}

/** Human-readable description of what a step did, for the screenplay. */
function describeStepAction(step: DemoStep): string | undefined {
  if (step.session) return `Run a ${step.session.kind} session (${step.session.turns.length} turn(s))`;
  if (step.goto) return `Navigate to ${step.goto}`;
  if (step.click) return `Click "${step.click}"`;
  if (step.selector) return `Interact with ${step.selector}`;
  if (step.fill) return `Fill ${Object.keys(step.fill).join(", ")}`;
  if (step.pointer) return `Click at (${Math.round(step.pointer.x)}, ${Math.round(step.pointer.y)})`;
  return undefined;
}

function baseUrl(script: DemoScript): string {
  return script.baseUrl.replace(/\/$/, "");
}

/** Build the timestamped screenplay from the recorded scenes. Scene durations
 *  are filled from the next scene's start (or the video end), so the narrator
 *  knows exactly how long each line has. */
function buildScreenplay(script: DemoScript, scenes: DemoScreenplayScene[], totalSec: number): DemoScreenplay {
  const withOrder = scenes.map((s, i) => ({ ...s, order: i }));
  const sorted = [...withOrder].sort((a, b) => a.atSec - b.atSec);
  for (let i = 0; i < sorted.length; i++) {
    const end = i + 1 < sorted.length ? sorted[i + 1].atSec : totalSec;
    sorted[i].durSec = Math.max(0, Math.round((end - sorted[i].atSec) * 10) / 10);
  }
  const restored = [...sorted].sort((a, b) => a.order - b.order).map(({ order, ...rest }) => rest);
  return {
    title: script.title ?? script.intro?.title ?? script.valueProp,
    valueProp: script.valueProp ?? script.intro?.tagline,
    baseUrl: script.baseUrl,
    createdAt: new Date().toISOString(),
    totalSec: Math.round(totalSec * 10) / 10,
    scene: restored,
  };
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Markdown screenplay: a timestamped, human-readable "what to say" script
 *  that accompanies the silent video. */
export function renderScreenplayMd(s: DemoScreenplay): string {
  const lines: string[] = [];
  lines.push(`# ${s.title ?? "Product demo"}`);
  lines.push("");
  if (s.valueProp) lines.push(`> ${s.valueProp}`);
  lines.push("");
  lines.push(`- App: ${s.baseUrl}`);
  lines.push(`- Total: ${fmtTime(s.totalSec)}`);
  lines.push(`- Recorded: ${s.createdAt}`);
  lines.push("");
  lines.push("## Script");
  lines.push("");
  for (const sc of s.scene) {
    lines.push(`### ${fmtTime(sc.atSec)} - ${fmtTime(sc.atSec + sc.durSec)} | ${sc.name}`);
    if (sc.action) lines.push(`_${sc.action}_`);
    lines.push("");
    lines.push(sc.narrate ? `"${sc.narrate}"` : "_(no narration yet - write your line)_");
    lines.push("");
  }
  lines.push("---");
  lines.push("Re-record narration: edit this script's lines, then re-run `demo` with `--voice` and the same walkthrough.");
  return lines.join("\n");
}

/** Write per-scene caption files so captions burn the narration text into the
 *  video. Renders each caption to a transparent PNG (via PIL - no ffmpeg
 *  drawtext/ass dependency) so the always-present `overlay` filter can place
 *  them. Returns {png, start, end}[] in video order. */
async function writeCaptionFiles(
  script: DemoScript,
  scenes: DemoScreenplayScene[],
  staging: string
): Promise<{ png: string; start: number; end: number }[]> {
  const caps: { text: string; start: number; end: number; size: number; fullWidth?: boolean }[] = [];
  if (script.intro?.title || script.intro?.tagline) {
    const title = script.intro.title ?? script.title ?? "";
    const tagline = script.intro.tagline ?? script.valueProp ?? "";
    caps.push({ text: title, start: 0, end: Math.min(scenes[0]?.atSec ?? 4, 4), size: 64, fullWidth: true });
    if (tagline) caps.push({ text: tagline, start: 0.4, end: Math.min(scenes[0]?.atSec ?? 4, 4) + 0.4, size: 30, fullWidth: true });
  }
  for (const sc of scenes) {
    if (!sc.narrate) continue;
    caps.push({ text: sc.narrate, start: sc.atSec, end: sc.atSec + sc.durSec, size: 30 });
  }

  const jobs = caps.map((c, i) => ({ index: i, text: c.text.replace(/\n/g, " "), start: c.start, end: c.end, size: c.size, fullWidth: !!c.fullWidth }));
  const spec = join(staging, "captions.json");
  writeFileSync(spec, JSON.stringify(jobs));
  const scriptPath = join(dirname(staging), "render-captions.py");
  const py = `import json, sys
from PIL import Image, ImageDraw, ImageFont
jobs = json.load(open(sys.argv[1]))
fontdir = "/System/Library/Fonts/Supplemental/"
for j in jobs:
    out = sys.argv[2] + "/cap-" + str(j["index"]).zfill(3) + ".png"
    size = j["size"]
    font = ImageFont.truetype(fontdir + "Arial.ttf", size)
    text = j["text"]
    pad = size
    dummy = Image.new("RGBA", (10, 10))
    tmp = ImageDraw.Draw(dummy)
    if j.get("fullWidth"):
        box = tmp.textbbox((0, 0), text, font=font)
        tw, th = box[2] - box[0], box[3] - box[1]
        W = 1280
        img = Image.new("RGBA", (W, th + pad * 2), (0, 0, 0, 0))
    else:
        box = tmp.textbbox((0, 0), text, font=font)
        tw, th = box[2] - box[0], box[3] - box[1]
        img = Image.new("RGBA", (tw + pad * 2, th + pad), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    padx = pad
    pady = pad // 2
    d.rounded_rectangle([0, 0, img.width - 1, img.height - 1], radius=12, fill=(0, 0, 0, 150))
    d.text((padx - bbox[0], pady - bbox[1]), text, font=font, fill=(255, 255, 255, 255))
    img.save(out)
`;
  writeFileSync(scriptPath, py);
  await runCmd("python3", [scriptPath, spec, staging]);
  rmSync(scriptPath, { force: true });
  return jobs.map((j, i) => ({ png: join(staging, `cap-${String(i).padStart(3, "0")}.png`), start: j.start, end: j.end }));
}

/** Render a final video: base recording + optional TTS narration mixed at
 *  timestamps + optional burn-in captions + optional crop (for OS screen
 *  captures). Exported so the walkthrough path can reuse it to mix narration
 *  onto a real screen recording.
 *  `endSec` trims the output so it doesn't run past the last narration. */
export async function renderVideo(
  videoPath: string,
  narrated: { file: string; atSec: number; durSec: number }[],
  scenes: DemoScreenplayScene[],
  captionFiles: { png: string; start: number; end: number }[],
  outPath: string,
  scale: string,
  withVoice: boolean,
  withCaptions: boolean,
  endSec?: number,
  cropRect?: { x: number; y: number; w: number; h: number }
): Promise<void> {
  const inputs: string[] = ["-y", "-i", videoPath];
  captionFiles.forEach((c) => inputs.push("-loop", "1", "-framerate", "30", "-i", c.png));
  narrated.forEach((n) => inputs.push("-i", n.file));
  const totalSec = endSec ?? (await probeDuration(videoPath));
  // Fade both tracks to black/silence over the last ~0.8s so even a script
  // without an outro ends cleanly instead of cutting off.
  const fadeStart = Math.max(0, totalSec - 0.8);

  // Input index bookkeeping: 0 = video, 1..N = captions, then narration.
  const nCaptions = captionFiles.length;

  let filter = "";
  const mixes: string[] = [];
  if (withVoice && narrated.length) {
    filter += `anullsrc=r=24000:cl=stereo[sil];`;
    mixes.push("[sil]");
    narrated.forEach((n, i) => {
      filter += `[${1 + nCaptions + i}:a]adelay=${Math.round(n.atSec * 1000)}|${Math.round(n.atSec * 1000)},volume=4.0,alimiter=limit=0.95[a${i}];`;
      mixes.push(`[a${i}]`);
    });
  }

  // Video chain: crop the OS screen capture to the app window (if given), scale
  // the base, then overlay each caption in its window.
  const prevLabel = "[0:v]";
  const parts: string[] = [];
  parts.push(cropRect ? `[0:v]crop=${cropRect.w}:${cropRect.h}:${cropRect.x}:${cropRect.y},scale=${scale},format=yuv420p[s0]` : `[0:v]scale=${scale},format=yuv420p[s0]`);
  captionFiles.forEach((c, i) => {
    parts.push(`[s${i}][${1 + i}:v]overlay=x=(W-w)/2:y=H-h-90:enable='between(t,${c.start.toFixed(2)},${c.end.toFixed(2)})'[s${i + 1}]`);
  });
  parts.push(`[s${nCaptions}]setsar=1,format=yuv420p,fade=t=in:st=0:d=0.25,fade=t=out:st=${fadeStart.toFixed(2)}:d=0.8[vout]`);
  filter += parts.join(";") + ";";

  if (mixes.length) {
    filter += `${mixes.join("")}amix=inputs=${mixes.length}:duration=longest:dropout_transition=0:normalize=0,afade=t=out:st=${fadeStart.toFixed(2)}:d=0.8[aout]`;
  } else {
    filter += `anullsrc=r=24000:cl=stereo,afade=t=out:st=${fadeStart.toFixed(2)}:d=0.8[aout]`;
  }

  const args = [...inputs, "-filter_complex", filter, "-map", "[vout]", "-map", "[aout]", "-t", totalSec.toFixed(3), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", outPath];
  await runFfmpeg(args);
}

/** Guided mode: screenshot, ask the vision LLM for the next action + narration,
 *  perform it, and repeat until "done", a repeat action, or the step budget.
 *  Runs inline so each screenshot the vision LLM sees reflects the post-action
 *  page. Records narration + step count into the shared result arrays. Narration
 *  is anchored to the post-transition screen (not the action start) and TTS is
 *  synthesized after the screen settles, so voice stays in sync. */
async function runGuidedSession(
  page: Page,
  script: DemoScript,
  opts: DemoOptions,
  staging: string,
  t0: number,
  voice: string,
  ttsCmd: string,
  narrated: { file: string; atSec: number; durSec: number }[],
  scenes: DemoScreenplayScene[],
  cursorSec: number
): Promise<{ stepsRun: number; error?: string }> {
  const budget = Math.max(script.steps.length, 8);
  const llmBase = script.llmBaseUrl ?? LLM_BASE;
  const model = script.llmModel ?? DEFAULT_LLM;
  const seen = new Set<string>();
  let stepsRun = 0;
  let error: string | undefined;
  const dpr = await page.evaluate(() => window.devicePixelRatio).catch(() => 1);
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };

  for (let attempts = 1; stepsRun < budget; attempts++) {
    const png = join(staging, `guided-${String(attempts).padStart(3, "0")}.png`);
    await page.screenshot({ path: png, fullPage: false }).catch(() => null);
    const act = await askVision(png, llmBase, model);
    if (!act || act.action === "done" || !act.target || !act.narrate) break;
    const key = `${act.action}|${act.target}`;
    if (seen.has(key)) {
      if (stepsRun >= 3) break;
      await page.waitForTimeout(600);
      continue;
    }
    seen.add(key);
    const step: DemoStep = { name: act.target, narrate: act.narrate };
    if (act.action === "goto") step.goto = act.target;
    else if (act.action === "click") step.click = act.target;
    if (act.x !== undefined && act.y !== undefined) {
      const px = act.x / dpr;
      const py = act.y / dpr;
      if (px >= 0 && px <= viewport.width && py >= 0 && py <= viewport.height) {
        step.pointer = { x: px, y: py };
      }
    }
    try {
      await runStep(page, baseUrl(script), step);
    } catch (e) {
      error = `Guided step "${step.name}" failed: ${e instanceof Error ? e.message : String(e)}`;
      break;
    }
    await page.waitForTimeout(step.settleMs ?? opts.settleMs ?? 400);
    const screenReadySec = (Date.now() - t0) / 1000;
    const scrollMode = step.scroll === undefined ? (script.scroll ?? "tour") : step.scroll;
    if (scrollMode) await scrollPage(page, scrollMode);

    let clipDurSec = 0;
    if (step.narrate) {
      const audioOut = join(staging, `narr-${String(stepsRun).padStart(3, "0")}.wav`);
      await synthNarration(step.narrate, voice, 180, ttsCmd, audioOut).catch(() => null);
      if (existsSync(audioOut)) clipDurSec = await probeDuration(audioOut).catch(() => 0);
      const narrateAtSec = Math.max(screenReadySec, cursorSec);
      const remainingBefore = narrateAtSec - (Date.now() - t0) / 1000;
      if (remainingBefore > 0) await page.waitForTimeout(remainingBefore * 1000);
      if (existsSync(audioOut)) narrated.push({ file: audioOut, atSec: narrateAtSec, durSec: clipDurSec });
      if (clipDurSec) cursorSec = narrateAtSec + clipDurSec + 0.3;
      const holdUntilSec = (narrateAtSec + clipDurSec + 0.4);
      const remainingHold = holdUntilSec - (Date.now() - t0) / 1000;
      if (remainingHold > 0) await page.waitForTimeout(remainingHold * 1000);
      scenes.push({ atSec: narrateAtSec, durSec: 0, name: step.name, action: describeStepAction(step), narrate: step.narrate });
    } else {
      scenes.push({ atSec: screenReadySec, durSec: 0, name: step.name, action: describeStepAction(step), narrate: undefined });
    }
    stepsRun++;
  }
  return { stepsRun, error };
}

interface VisionAction {
  action: "click" | "goto" | "done";
  target?: string;
  narrate?: string;
  /** Optional cursor coordinates (device pixels) where click should land. Used
   *  when the LLM is confident about the pixel location; otherwise the target
   *  label is resolved via the DOM. */
  x?: number;
  y?: number;
}

/** Ask the vision LLM to describe the screenshot and propose a demo step. */
async function askVision(pngPath: string, baseUrl: string, model: string): Promise<VisionAction | null> {
  const sys =
    "You drive a recorded product walkthrough. Look at the screenshot and decide the single most natural next step a user takes on this screen. " +
    'Respond ONLY as JSON: {"action": "click"|"goto"|"done", "target": "exact visible link/button label or relative path", "narrate": "one short demo voiceover line under 20 words", "x": optional pixel column, "y": optional pixel row}. ' +
    "For a click, set x/y to the pixel center of the element if you can locate it precisely; otherwise omit them and I will resolve the label. " +
    'If the screen is a dead end or the walkthrough is complete, respond {"action":"done"}.';
  const res = await localChat({
    system: sys,
    text: "What is the next step and narration?",
    images: [pngPath],
    baseUrl,
    model,
    maxTokens: 800,
    temperature: 0.2,
  });
  if (res.error || !res.content) return null;
  const match = res.content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as VisionAction;
    if (parsed.x !== undefined) parsed.x = Math.round(Number(parsed.x));
    if (parsed.y !== undefined) parsed.y = Math.round(Number(parsed.y));
    return parsed;
  } catch {
    return null;
  }
}

/** Write a one-line demo voiceover for a screen the script didn't pre-write. */
async function describeScreen(pngPath: string, name: string, baseUrl: string, model: string): Promise<string | undefined> {
  const sys =
    "You write narration for a product demo video. Look at the screenshot and write ONE short voiceover line (under 20 words) " +
    "that tells the viewer what this screen is and why it matters. Plain sentence, no quotes, no markdown.";
  const res = await localChat({
    system: sys,
    text: `Screen: "${name}". Write the demo narration line.`,
    images: [pngPath],
    baseUrl,
    model,
    maxTokens: 200,
    temperature: 0.4,
  });
  if (res.error || !res.content) return undefined;
  return res.content.replace(/\s+/g, " ").trim().replace(/^"|"$/g, "").slice(0, 200) || undefined;
}

/** Synthesize a demo script draft from a discovered graph + prioritized paths:
 *  walks each path's edges, producing goto/click steps named by their target
 *  screen. Narration is left empty - auto-narrate fills it at render time, and
 *  the user can edit the draft before rendering. */
export function synthesizeDemoScript(graph: GraphVersion, paths: PrioritizedPath[], valueProp?: string): DemoScript {
  const edgesById = new Map(graph.edges.map((e) => [e.id, e]));
  const steps: DemoStep[] = [];
  const seenEdges = new Set<string>();
  for (const path of paths) {
    for (const s of path.steps) {
      if (!s.edgeId || seenEdges.has(s.edgeId)) continue;
      const edge = edgesById.get(s.edgeId);
      if (!edge || !edge.to) continue;
      seenEdges.add(s.edgeId);
      const targetNode = graph.nodes[edge.to];
      // Prefer the path URL for the step name (e.g. "/lumen/studio") - the
      // node title is often the app name, repeated on every screen.
      const stepName = s.expectedNodeId ?? edge.to ?? targetNode?.title ?? "Screen";
      const quoted = edge.action.match(/"([^"]*)"/)?.[1];
      const step: DemoStep = { name: stepName };
      if (quoted && quoted.startsWith("/")) step.goto = quoted;
      else if (quoted) step.click = quoted;
      else step.goto = edge.to;
      steps.push(step);
    }
  }
  return {
    valueProp,
    baseUrl: "http://localhost:3000",
    entry: graph.entryPoints[0],
    steps,
  };
}

async function runStep(page: Page, baseUrl: string, step: DemoStep): Promise<void> {
  // A step with BOTH click and goto means "click this label to arrive at
  // that screen" (a real user navigates by clicking, not typing a URL) - try
  // the click first so the cursor actually moves, falling back to a direct
  // goto only if the label never shows up.
  if (step.click && step.goto && !step.fill && !step.selector && !step.pointer) {
    if (await tryClick(page, step)) return;
    const target = step.goto.split("?")[0].split("#")[0];
    await page.goto(`${baseUrl}${target}`, { waitUntil: "domcontentloaded", timeout: 20000 });
    return;
  }
  if (step.goto) {
    const target = step.goto.split("?")[0].split("#")[0];
    await page.goto(`${baseUrl}${target}`, { waitUntil: "domcontentloaded", timeout: 20000 });
    return;
  }
  if (step.fill) {
    for (const [selector, value] of Object.entries(step.fill)) {
      const locator = page.locator(selector).first();
      const center = await elementCenter(page, locator);
      if (center) await humanClick(page, center.x, center.y);
      // The coordinate click parks the visible cursor, but focus by
      // coordinates is flaky (found live: typed text landed nowhere and a
      // save-on-blur never fired). Guarantee focus programmatically before
      // typing - the recording still shows the cursor over the field.
      await locator.focus().catch(() => null);
      // park the cursor in the field, then type like a person
      const raw = String(value);
      const wantsEnter = raw.endsWith("\n");
      const text = wantsEnter ? raw.slice(0, -1) : raw;
      await page.keyboard.type(raw, { delay: 45 }).catch(() => null);
      // Hydration guard: on a React app, typing before the client bundle
      // hydrates lands in a controlled input with no handlers - the framework
      // then re-renders its own (empty) value and the keystrokes vanish
      // (found live: a save-on-blur field stayed blank in the recording while
      // the identical flow passed in a networkidle-gated probe). Verify what
      // actually stuck; if it differs, wait for quiet network and fill via
      // the protocol, which fires proper input events post-hydration.
      const got = await locator.inputValue().catch(() => null);
      if (got !== null && got !== text) {
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => null);
        await locator.fill(text, { timeout: 4000 }).catch(() =>
          locator.selectOption(text, { timeout: 4000 }).catch(() => null)
        );
        if (wantsEnter) await locator.press("Enter").catch(() => null);
      }
    }
    await page.waitForTimeout(200);
    // A step can carry both fill and click (e.g. the login scene's "fill the
    // form, then click Sign in") - returning here unconditionally silently
    // dropped that click (and its cursor glide) on every such step. Submit
    // via the click now that the fields are filled.
    if (step.click) await tryClick(page, step);
    return;
  }
  if (step.selector) {
    const locator = page.locator(step.selector).first();
    const center = await elementCenter(page, locator);
    if (center) return humanClick(page, center.x, center.y);
    return locator.click({ timeout: 8000 });
  }
  if (step.pointer) {
    await humanClick(page, step.pointer.x, step.pointer.y);
    return;
  }
  if (step.click) {
    if (await tryClick(page, step)) return;
    throw new Error(`click target "${step.click}" never appeared within ${step.clickTimeoutMs ?? 8000}ms`);
  }
}

/** Poll the whole label-matching strategy ladder until the step's deadline
 *  (a target may take a while to EXIST at all - e.g. a button that only
 *  renders once a model call finishes) - clickTimeoutMs raises the deadline
 *  for known-slow screens. Returns false (never throws) once the deadline
 *  passes with no match, so a caller can fall back to a direct goto. */
async function tryClick(page: Page, step: DemoStep): Promise<boolean> {
  const label = step.click!;
  const deadline = Date.now() + (step.clickTimeoutMs ?? 8000);
  for (;;) {
    const byLink = page.getByRole("link", { name: label, exact: true }).first();
    if (await byLink.isVisible().catch(() => false)) {
      const c = await elementCenter(page, byLink);
      if (c) await humanClick(page, c.x, c.y); else await byLink.click({ timeout: 8000 });
      return true;
    }
    const byButton = page.getByRole("button", { name: label, exact: true }).first();
    if (await byButton.isVisible().catch(() => false)) {
      const c = await elementCenter(page, byButton);
      if (c) await humanClick(page, c.x, c.y); else await byButton.click({ timeout: 8000 });
      return true;
    }
    // Fuzzy fallback: prefer a link whose text contains the label (a link has a
    // navigable href), then a button, then any element. Clicking an arbitrary
    // element that "looks like" the label is what silently no-ops a step like
    // `click: "Studio"` when no exact match exists - prefer real navigation.
    const fuzzyLink = page.locator(`a:has-text("${cssEscape(label)}")`).first();
    if (await fuzzyLink.isVisible().catch(() => false)) {
      const c = await elementCenter(page, fuzzyLink);
      if (c) await humanClick(page, c.x, c.y); else await fuzzyLink.click({ timeout: 8000 });
      return true;
    }
    const fuzzyButton = page.locator(`button:has-text("${cssEscape(label)}")`).first();
    if (await fuzzyButton.isVisible().catch(() => false)) {
      const c = await elementCenter(page, fuzzyButton);
      if (c) await humanClick(page, c.x, c.y); else await fuzzyButton.click({ timeout: 8000 });
      return true;
    }
    const byText = page.getByText(label, { exact: false }).first();
    if (await byText.isVisible().catch(() => false)) {
      const c = await elementCenter(page, byText);
      if (c) await humanClick(page, c.x, c.y); else await byText.click({ timeout: 8000 });
      return true;
    }
    if (Date.now() > deadline) return false;
    await page.waitForTimeout(1000);
  }
}

/** Escape a label for safe use inside a CSS attribute selector. */
function cssEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("ffmpeg", args, { maxBuffer: 1024 * 1024 * 16 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg failed: ${stderr || err.message}`));
      else resolve(void stdout);
    });
  });
}

function runCmd(cmd: string, args: string[], env: Record<string, string> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { env: { ...process.env, ...env }, maxBuffer: 1024 * 1024 * 16 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} failed: ${stderr || err.message}`));
      else resolve(void stdout);
    });
  });
}

export type { Edge, GraphVersion, PrioritizedPath };
