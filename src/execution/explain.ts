// Explainer video assembly: a screenplay of scenes (each a screenshot plus a
// narration line) becomes one narrated MP4. Per scene it synthesizes TTS audio
// with Gemini 2.5 Flash TTS (neural, ~$0.02/video, needs GEMINI_API_KEY) and
// falls back to macOS `say`, or any external TTS via the --tts-cmd hook, then
// encodes image+audio to a clip and concatenates all clips into the final
// video. Requires ffmpeg + ffprobe on the PATH.
//
// Screenplay format (JSON):
//   {
//     "title": "easy-dist: distribution for solo founders",
//     "scene": [
//       { "png": "data/.../shot_0.png", "narrate": "Ship the product." },
//       { "png": "data/.../shot_1.png", "narrate": "The platform finds the buyers.", "holdAfter": 1.5 }
//     ]
//   }
// A scene without "narrate" is a silent title/hold card for holdAfter seconds
// (default 2.0). Scene length = narration audio length + holdAfter.
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { ensureTtsCacheDir, ttsCacheDir } from "../llm/tts-cache.js";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";

// Cache location is anchored to the package, not the caller's cwd - see
// src/llm/tts-cache.ts for why that mattered.

export interface CursorKeyframe {
  /** Seconds from scene start when the cursor should be at this position. */
  at: number;
  x: number;
  y: number;
}

export interface ExplainScene {
  png: string;
  narrate?: string;
  holdAfter?: number;
  /** Optional cursor path: the cursor sprite glides to each keyframe at its
   *  `at` time (eased between points), then holds at the last one. Times are
   *  relative to scene start (0 = narration begins). Lets a tutorial video
   *  literally point at the diagram element being narrated. */
  cursor?: CursorKeyframe[];
}

export interface ExplainScript {
  title?: string;
  scene: ExplainScene[];
}

export interface ExplainOptions {
  /** TTS voice: Gemini neural voice (e.g. "Kore", "Puck", "Charon") used when
   *  GEMINI_API_KEY is set; otherwise a macOS `say` voice like "Samantha". */
  voice?: string;
  /** Words per minute for the `say` fallback (default 180). */
  rate?: number;
  /** Optional shell command used to synthesize audio; receives TTS_TEXT and
   *  TTS_OUT env vars and must write an audio file at $TTS_OUT. */
  ttsCmd?: string;
  /** Output resolution/filter, e.g. "1280:-2" (default: scaled to 1280 wide). */
  scale?: string;
  /** Click this many seconds off each narration line's tail. */
  trailing?: number;
  fps?: number;
}

interface SceneDuration {
  audioSec: number;
  totalSec: number;
}

/** A cursor arrow sprite (32x32 RGBA) used to point at diagram elements in
 *  explainer/tutorial videos. Inlined so no external asset is needed. */
const CURSOR_SPRITE_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAs0lEQVR4nO2XUQ6EIAxEO5M9gvc/oXcY48ZszAZUoC0/zie0zOtgTDB79SdJskRxNgRLiwDWLAhmmHQBICkFXm1mQPCuIBqCT4oiIfi0MAqC3geGAiAgBbY2eEOwp8kTgr2NXhAcafaAoE0WRw8YTeHT2iBpqawLAMIBdvUYDV2BTlOn/wdUiTwFQNKCQ1Ep8M7cgoWC8Xeykvnxpa+ekCxSJUz+87JGne8+E3Tay+mVRWsDDWd3ffwt8NYAAAAASUVORK5CYII=";

/** Write the cursor sprite to a PNG file under `dir`, scaled by `scale` (1 =
 *  native 32px). Returns the file path. */
async function writeCursorSprite(dir: string, scale = 2.0): Promise<string> {
  const out = join(dir, "cursor-sprite.png");
  writeFileSync(out, Buffer.from(CURSOR_SPRITE_B64, "base64"));
  if (scale === 1) return out;
  const scaled = join(dir, `cursor-sprite-${scale}.png`);
  await runCmd("python3", [
    "-c",
    `from PIL import Image; s=float('${scale}'); im=Image.open('${out}'); w,h=im.size; im=im.resize((int(w*s),int(h*s))); im.save('${scaled}')`,
  ], {});
  return scaled;
}

/** Synthesize narration text to an audio file (returns the path). Uses the
 *  same backend as the explainer: --tts-cmd, then Gemini TTS when
 *  GEMINI_API_KEY is set, then macOS say. */
export async function synthNarration(text: string, voice: string, rate: number, ttsCmd: string, outPath: string): Promise<string> {
  return synthTts(text, voice, rate, ttsCmd, outPath);
}

/** Duration (seconds) of an audio/video file via ffprobe. */
export function probeDuration(path: string): Promise<number> {
  return audioDuration(path);
}

/** Assemble scene screenshots + narration into a narrated MP4. Returns the
 *  output path. Requires ffmpeg and ffprobe; default TTS uses Gemini. */
export async function renderExplainer(scriptPath: string, outPath: string, opts: ExplainOptions = {}): Promise<string> {
  const script: ExplainScript = JSON.parse(readFileSync(scriptPath, "utf-8"));
  if (!Array.isArray(script.scene) || !script.scene.length) throw new Error("Screenplay needs a non-empty \"scene\" array.");
  return renderNarratedVideo(script.scene, outPath, opts);
}

/** Shared narrated-video assembler: each scene (a PNG plus an optional
 *  narration line) becomes a clip whose length is narration + holdAfter, and
 *  all clips are concatenated. Also used by the demo walkthrough. */
export async function renderNarratedVideo(scenes: ExplainScene[], outPath: string, opts: ExplainOptions = {}): Promise<string> {
  if (!scenes.length) throw new Error("Need at least one scene.");

  const dir = dirname(outPath);
  mkdirSync(dir, { recursive: true });
  const staging = `${dir}/.explain-${basename(outPath)}-${process.pid}`;
  mkdirSync(staging, { recursive: true });

  const voice = opts.voice ?? process.env.GEMINI_API_KEY ? "Kore" : "Samantha";
  const rate = opts.rate ?? 180;
  const fps = opts.fps ?? 30;
  const trailing = opts.trailing ?? 0.2;
  const scale = opts.scale ?? "1280:-2";
  const titles = opts.ttsCmd ?? "";

  const durations: SceneDuration[] = [];
  const clips: string[] = [];

  try {
    const cursorSprite = scenes.some((s) => s.cursor?.length) ? await writeCursorSprite(staging, 3.0) : undefined;
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      if (!sc.png || !existsSync(sc.png)) throw new Error(`Scene ${i + 1} missing PNG at "${sc.png}"`);
      const audio = sc.narrate ? await synthTts(sc.narrate, voice, rate, titles, `${staging}/scene-${String(i + 1).padStart(2, "0")}.aiff`) : null;
      const audioSec = audio ? await audioDuration(audio) : 0;
      const hold = sc.holdAfter ?? (sc.narrate ? 0.6 : 2.0);
      const totalSec = audioSec + trailing + hold;
      durations.push({ audioSec, totalSec });

      const clip = `${staging}/scene-${String(i + 1).padStart(2, "0")}.mp4`;
      await encodeScene(sc.png, audio, totalSec, clip, { fps, scale, cursor: sc.cursor ? { kfs: sc.cursor, sprite: cursorSprite! } : undefined });
      clips.push(clip);
    }

    await concatClips(clips, outPath);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  return outPath;
}

/** Synthesize narration to an audio file. Backend priority (each falls
 *  through to the next on failure):
 *  1. --tts-cmd hook
 *  2. Gemini 2.5 Flash TTS (neural, ~$0.02/video) when GEMINI_API_KEY is set
 *  3. local Kokoro-82M neural TTS (free, `uv tool install kokoro --with soundfile`)
 *  4. macOS `say`
 *  TTS_BACKEND=gemini|kokoro|say pins a backend (auto = all in order).
 *  Writes .wav (Gemini/Kokoro) or .aiff (say). */
async function synthTts(text: string, voice: string, rate: number, ttsCmd: string, outPath: string): Promise<string> {
  const backend = (process.env.TTS_BACKEND || "auto").toLowerCase();
  // Content-hash cache: identical (backend, ttsCmd, voice, rate, text) reuses
  // the clip - re-rendering a video with unchanged narration lines stops
  // burning TTS quota on the same audio every time.
  const cacheKey = createHash("sha1").update(`${backend}|${ttsCmd}|${voice}|${rate}|${text}`).digest("hex");
  const cached = join(ttsCacheDir(), cacheKey);
  if (existsSync(cached)) {
    copyFileSync(cached, outPath);
    return outPath;
  }
  // Metering: one tts cost event per synthesized clip (estimate ledger) - only
  // on a cache miss, since a cache hit costs nothing.
  try {
    const { recordCost } = await import("../usage/ledger.js");
    recordCost("tts", `tts:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`, 1, { note: `${voice} ${text.length} chars` });
  } catch { /* never block synthesis */ }
  const candidates: Array<() => Promise<void>> = [];
  if (ttsCmd) candidates.push(() => runCmd("sh", ["-c", ttsCmd], { TTS_TEXT: text, TTS_OUT: outPath, TTS_VOICE: voice }));
  if (backend === "gemini") candidates.push(() => synthGeminiTts(text, voice, outPath));
  else if (backend === "kokoro") candidates.push(() => synthKokoroTts(text, rate, outPath));
  else if (backend === "say") candidates.push(() => synthSayTts(text, voice, rate, outPath));
  else {
    if (process.env.GEMINI_API_KEY) candidates.push(() => synthGeminiTts(text, voice, outPath));
    candidates.push(() => synthKokoroTts(text, rate, outPath));
    candidates.push(() => synthSayTts(text, voice, rate, outPath));
  }
  let lastErr: unknown;
  for (const render of candidates) {
    rmSync(outPath, { force: true });
    try {
      await render();
      if (existsSync(outPath)) {
        try { if (ensureTtsCacheDir()) copyFileSync(outPath, cached); } catch { /* cache best-effort */ }
        return outPath;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error(`TTS: no backend produced audio at ${outPath}`);
}

const KOKORO_VOICES = ["af_heart", "af_bella", "af_nicole", "af_aoede", "af_kore", "am_michael", "am_fenrir", "am_puck", "bm_george", "bm_lewis"];

/** Kokoro-82M neural TTS (local, Apache-2.0). Rate is a wpm hint: map 1.0
 *  speed at 180wpm, clamp to kokoro's supported range. */
async function synthKokoroTts(text: string, rate: number, outPath: string): Promise<void> {
  const speed = Math.min(1.3, Math.max(0.6, rate / 180));
  const voice = KOKORO_VOICES.includes(process.env.TTS_VOICE_KOKORO ?? "") ? process.env.TTS_VOICE_KOKORO! : "af_heart";
  await runCmd("kokoro", ["-m", voice, "-s", speed.toFixed(2), "-t", text, "-o", outPath], {});
}

/** macOS `say` fallback - writes native .aiff then renames to outPath. */
async function synthSayTts(text: string, voice: string, rate: number, outPath: string): Promise<void> {
  const aiff = `${outPath}.aiff`;
  await runCmd("say", ["-o", aiff, "--voice", voice, "-r", String(rate), text], {});
  if (!existsSync(aiff)) throw new Error(`say produced no audio at ${aiff}`);
  copyFileSync(aiff, outPath);
  rmSync(aiff, { force: true });
}

const GEMINI_TTS_MODEL = "gemini-3.1-flash-tts-preview";
const GEMINI_VOICES = ["Kore", "Puck", "Zephyr", "Charon", "Fenrir", "Aoede", "Leda", "Orus"];

/** Gemini 2.5 Flash TTS: returns 24kHz mono 16-bit PCM inline; wrap in a WAV
 *  header so ffmpeg/probe can consume it. Uses existing GEMINI_API_KEY. */
async function synthGeminiTts(text: string, voice: string, outPath: string): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY!;
  const voiceName = GEMINI_VOICES.includes(voice) ? voice : "Kore";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini TTS HTTP ${res.status}: ${await res.text()}`);
  const body: any = await res.json();
  const data = body?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data)?.inlineData?.data;
  const mime: string = body?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data)?.inlineData?.mimeType ?? "";
  if (!data) throw new Error(`Gemini TTS returned no audio: ${JSON.stringify(body).slice(0, 300)}`);
  const sampleRate = mime.startsWith("audio/L16") ? /rate=(\d+)/.exec(mime)?.[1] ?? "24000" : "24000";
  writePcmWav(Buffer.from(data, "base64"), Number(sampleRate), outPath);
}

/** Wrap raw 16-bit mono PCM in a WAV file (44-byte header). */
function writePcmWav(pcm: Buffer, sampleRate: number, outPath: string): void {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);          // fmt chunk size
  h.writeUInt16LE(1, 20);           // PCM
  h.writeUInt16LE(1, 22);           // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28); // byte rate
  h.writeUInt16LE(2, 32);           // block align
  h.writeUInt16LE(16, 34);          // bits per sample
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  writeFileSync(outPath, Buffer.concat([h, pcm]));
}

function audioDuration(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
      { maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) reject(new Error(`ffprobe failed: ${err.message}`));
        else resolve(parseFloat(stdout.trim()) || 0);
      }
    );
  });
}

/** One still image (+ optional narration audio) -> a scene clip. When the
 *  scene has cursor keyframes, a cursor sprite is overlaid and glides through
 *  the keyframe positions (eased), pointing at what the narration describes.
 *  The keyframe `at` times are relative to scene start. */
async function encodeScene(
  png: string,
  audio: string | null,
  durSec: number,
  outPath: string,
  c: { fps: number; scale: string; cursor?: { kfs: CursorKeyframe[]; sprite: string } }
): Promise<void> {
  const inputs = ["-y", "-loop", "1", "-framerate", String(c.fps), "-i", png];
  if (audio) inputs.push("-i", audio);
  else inputs.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");

  const hasCursor = !!(c.cursor?.kfs.length && c.cursor.sprite);
  if (hasCursor) inputs.push("-loop", "1", "-framerate", String(c.fps), "-i", c.cursor!.sprite);

  const fps = String(c.fps);
  const common = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", fps, "-t", durSec.toFixed(3), "-c:a", "aac", "-b:a", "128k", "-shortest", outPath];

  if (!hasCursor) {
    const vf = `scale=${c.scale},format=yuv420p`;
    await runFfmpeg([...inputs, "-vf", vf, ...common]);
    return;
  }

  // Cursor overlay needs a complex filtergraph (2 video inputs: background +
  // sprite). Inputs: 0 = png, 1 = audio (or anullsrc), 2 = cursor sprite.
  const kfs = c.cursor!.kfs;
  const seg = (a: CursorKeyframe, b: CursorKeyframe, coord: "x" | "y") => {
    const dur = Math.max(0.001, b.at - a.at);
    const u = `min((t-${a.at.toFixed(3)})/${dur.toFixed(3)},1)`;
    const ease = `(${u}*${u}*(3-2*${u}))`;
    return `(${a[coord]}+(${b[coord]}-${a[coord]})*${ease})`;
  };
  // Piecewise eased expression per axis; past the last keyframe, hold the last
  // point; before the first, hold the first point.
  let xExpr = String(kfs[kfs.length - 1].x);
  let yExpr = String(kfs[kfs.length - 1].y);
  for (let i = kfs.length - 2; i >= 0; i--) {
    xExpr = `if(lt(t,${kfs[i + 1].at.toFixed(3)}),${seg(kfs[i], kfs[i + 1], "x")},${xExpr})`;
    yExpr = `if(lt(t,${kfs[i + 1].at.toFixed(3)}),${seg(kfs[i], kfs[i + 1], "y")},${yExpr})`;
  }
  xExpr = `if(lt(t,${kfs[0].at.toFixed(3)}),${kfs[0].x},${xExpr})`;
  yExpr = `if(lt(t,${kfs[0].at.toFixed(3)}),${kfs[0].y},${yExpr})`;

  const fc = `[0:v]scale=${c.scale},format=yuv420p[bg];[bg][2:v]overlay=x='${xExpr}':y='${yExpr}':eof_action=pass,format=yuv420p[vout]`;
  await runFfmpeg([...inputs, "-filter_complex", fc, "-map", "[vout]", "-map", "1:a?", ...common]);
}

/** Concat encoder-identical clips -c copy via the concat demuxer. */
async function concatClips(clips: string[], outPath: string): Promise<void> {
  const list = `${dirname(outPath)}/.concat-${basename(outPath)}-${process.pid}.txt`;
  const fs = await import("node:fs");
  fs.writeFileSync(
    list,
    clips.map((c) => `file '${c.replace(/'/g, "\\'")}'`).join("\n") + "\n"
  );
  try {
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", outPath]);
  } finally {
    rmSync(list, { recursive: true, force: true });
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  if (process.env.UFT_DEBUG_FFMPEG) console.error("[ffmpeg]", args.join(" ").slice(0, 600));
  return new Promise((resolve, reject) => {
    execFile("ffmpeg", args, { maxBuffer: 1024 * 1024 * 16 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg failed: ${stderr || err.message}`));
      else resolve(void stdout);
    });
  });
}

function runCmd(cmd: string, args: string[], env: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { env: { ...process.env, ...env }, maxBuffer: 1024 * 1024 * 16 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} failed: ${stderr || err.message}`));
      else resolve(void stdout);
    });
  });
}