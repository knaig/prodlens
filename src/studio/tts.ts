// Spec: v2 §4.4 (PM2) - see spec/traceability.md
// Narration casting (spec v2 §4.4): voice + style as first-class fields.
// A style prompt (e.g. "Indian English accent, warm") is applied via Gemini's
// style-promptable TTS; without a style (or without a key) this defers to the
// standard synthNarration fallback chain (Gemini -> Kokoro -> say -> tts-cmd).
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { ensureTtsCacheDir, ttsCacheDir } from "../llm/tts-cache.js";
import { synthNarration } from "../execution/explain.js";
import type { VoiceSpec } from "./types.js";

const GEMINI_TTS_MODEL = "gemini-3.1-flash-tts-preview";


export async function synthCast(text: string, voice: VoiceSpec | undefined, outPath: string): Promise<string> {
  const name = voice?.name ?? "Kore";
  // Content-hash cache: identical (text, voice, style) reuses the clip -
  // iterative renders stop burning TTS quota on unchanged lines.
  const key = createHash("sha1").update(`${name}|${voice?.style ?? ""}|${text}`).digest("hex");
  const cached = join(ttsCacheDir(), `${key}.wav`);
  if (existsSync(cached)) {
    copyFileSync(cached, outPath);
    return outPath;
  }
  if (voice?.style && process.env.GEMINI_API_KEY) {
    try {
      await synthGeminiStyled(`Speak in this style - ${voice.style}: ${text}`, name, outPath);
      if (ensureTtsCacheDir()) copyFileSync(outPath, cached);
      try {
        const { recordCost } = await import("../usage/ledger.js");
        recordCost("tts", `tts:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`, 1, { note: `styled ${name}` });
      } catch { /* never block */ }
      return outPath;
    } catch {
      // fall through to the standard chain
    }
  }
  const res = await synthNarration(text, name, 180, "", outPath);
  try { if (ensureTtsCacheDir()) copyFileSync(outPath, cached); } catch { /* cache best-effort */ }
  return res;
}

async function synthGeminiStyled(text: string, voiceName: string, outPath: string): Promise<void> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } },
    }),
  });
  if (!res.ok) throw new Error(`Gemini TTS HTTP ${res.status}`);
  const body = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }> };
  const part = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new Error("Gemini TTS returned no audio");
  const pcm = Buffer.from(part.inlineData.data, "base64");
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? "")?.[1] ?? 24000);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  writeFileSync(outPath, Buffer.concat([h, pcm]));
}
