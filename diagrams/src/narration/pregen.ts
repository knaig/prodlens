// Narration pre-generation (spec 5.4): synthesize one clip per event using the
// cast provider, measure real durations with ffprobe, and write the manifest
// that drives per-step timing in both interactive playback and video export.
// Usage: npm run pregen  (env: GEMINI_API_KEY)
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callTrace } from "../fixtures/call-fixture";
import type { Trace } from "../schema";
import { GeminiCastProvider, SayProvider, VoiceboxProvider, type TtsProvider } from "./tts-provider";

/** Narrate the prepared real trace when one exists, else the fixture. Without
 *  this, pregen always voiced the fixture - so a manifest built for 8 fixture
 *  events was applied to a real 12-event trace, and the narration no longer
 *  matched what was on screen. Same precedence as Root.tsx. */
function activeTrace(): Trace {
  const prepared = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "data", "trace.json");
  if (!existsSync(prepared)) return callTrace;
  try {
    const t = JSON.parse(readFileSync(prepared, "utf-8")) as Trace;
    console.log(`[pregen] narrating prepared trace "${t.title}" (${t.events.length} events)`);
    return t;
  } catch {
    return callTrace;
  }
}
const trace = activeTrace();

const VOICEBOX_ROLE_PROFILES: Record<string, string> = {
  persona: "Bella",
  agent: "Kore",
  judge: "George",
  guardrail: "Fenrir",
  component: "Puck",
};
import type { NarrationManifest } from "../schema";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "..", "public", "narration");

function ffprobeDuration(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], (err, stdout) => {
      if (err) reject(err); else resolve(Number(stdout.trim()));
    });
  });
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  // Primary: local Voicebox (zero-cost, no quota). Fallback: Gemini neural cast,
  // then macOS say (per-role voices kept).
  let provider: TtsProvider & { voiceFor(a: unknown): string } = new VoiceboxProvider(VOICEBOX_ROLE_PROFILES);
  try {
    await provider.synth("Voice check.", trace.actors[0], join(outDir, "_check.wav"));
  } catch (e) {
    console.log(`[pregen] Voicebox unavailable (${e instanceof Error ? e.message : e}) - falling back to Gemini`);
    provider = new GeminiCastProvider(undefined, 3);
    try {
      await provider.synth("Voice check.", trace.actors[0], join(outDir, "_check.wav"));
    } catch (e2) {
      console.log(`[pregen] neural TTS unavailable (${e2 instanceof Error ? e2.message : e2}) - falling back to system voices`);
      provider = new SayProvider();
    }
  }
  if (provider instanceof GeminiCastProvider) {
    provider = new GeminiCastProvider(); // full retries for the real run
  }
  const manifest: NarrationManifest = { traceTitle: trace.title, items: [] };
  for (let i = 0; i < trace.events.length; i++) {
    const e = trace.events[i];
    const actor = trace.actors.find((a) => a.id === e.from);
    const text = e.narration ?? e.label;
    const file = `${i}.wav`;
    const { createHash } = await import("node:crypto");
    const { existsSync, copyFileSync } = await import("node:fs");
    const cacheDir = join(here, "..", "..", ".tts-cache");
    mkdirSync(cacheDir, { recursive: true });
    const ck = createHash("sha1").update(`${provider.voiceFor(actor)}|${text}`).digest("hex");
    const cached = join(cacheDir, `${ck}.wav`);
    if (existsSync(cached)) {
      console.log(`[pregen] ${i}: cache hit (${provider.voiceFor(actor)})`);
      copyFileSync(cached, join(outDir, file));
    } else {
      console.log(`[pregen] ${i}: ${actor?.displayName} (${provider.voiceFor(actor)}) - "${text.slice(0, 60)}..."`);
      await provider.synth(text, actor, join(outDir, file));
      copyFileSync(join(outDir, file), cached);
      if (provider instanceof GeminiCastProvider) {
        await new Promise((r) => setTimeout(r, 6500)); // Tier-1 TTS is 10 req/min - stay under it
      }
    }
    const durationSec = await ffprobeDuration(join(outDir, file));
    manifest.items.push({ index: i, file, durationSec: Number(durationSec.toFixed(3)), text, voice: provider.voiceFor(actor) });
  }
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`[pregen] ${manifest.items.length} clips, total ${manifest.items.reduce((s, m) => s + m.durationSec, 0).toFixed(1)}s -> ${join(outDir, "manifest.json")}`);
}

void main();
