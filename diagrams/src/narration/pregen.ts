// Narration pre-generation (spec 5.4): synthesize one clip per event using the
// cast provider, measure real durations with ffprobe, and write the manifest
// that drives per-step timing in both interactive playback and video export.
// Usage: npm run pregen  (env: GEMINI_API_KEY)
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callTrace } from "../fixtures/call-fixture";
import { GeminiCastProvider, SayProvider, type TtsProvider } from "./tts-provider";
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
  // Primary: Gemini neural cast. Fallback: macOS say (per-role voices kept).
  let provider: TtsProvider & { voiceFor(a: unknown): string } = new GeminiCastProvider(undefined, 1);
  try {
    await provider.synth("Voice check.", callTrace.actors[0], join(outDir, "_check.wav"));
  } catch (e) {
    console.log(`[pregen] neural TTS unavailable (${e instanceof Error ? e.message : e}) - falling back to system voices`);
    provider = new SayProvider();
  }
  if (provider instanceof GeminiCastProvider) {
    provider = new GeminiCastProvider(); // full retries for the real run
  }
  const manifest: NarrationManifest = { traceTitle: callTrace.title, items: [] };
  for (let i = 0; i < callTrace.events.length; i++) {
    const e = callTrace.events[i];
    const actor = callTrace.actors.find((a) => a.id === e.from);
    const text = e.narration ?? e.label;
    const file = `${i}.wav`;
    console.log(`[pregen] ${i}: ${actor?.displayName} (${provider.voiceFor(actor)}) - "${text.slice(0, 60)}..."`);
    await provider.synth(text, actor, join(outDir, file));
    const durationSec = await ffprobeDuration(join(outDir, file));
    manifest.items.push({ index: i, file, durationSec: Number(durationSec.toFixed(3)), text, voice: provider.voiceFor(actor) });
  }
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`[pregen] ${manifest.items.length} clips, total ${manifest.items.reduce((s, m) => s + m.durationSec, 0).toFixed(1)}s -> ${join(outDir, "manifest.json")}`);
}

void main();
