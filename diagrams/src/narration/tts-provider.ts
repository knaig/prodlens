// Pluggable TTS provider (spec 5.4). The concrete provider is the existing
// Gemini styled multi-voice cast - per-actor voices retained (persona, agent,
// judge, guardrail each speak in their own voice), style prompts preserved.
// Browser speechSynthesis is explicitly NOT a provider here (prototype-only,
// never in the export path).
import { writeFileSync } from "node:fs";
import type { Actor } from "../schema";

export interface TtsProvider {
  /** Synthesize `text` in the voice for `actor`, write audio to `outPath` (wav). */
  synth(text: string, actor: Actor | undefined, outPath: string): Promise<void>;
}

/** Actor-role -> Gemini prebuilt voice. Same cast rotation as the studio's
 *  cast-mode diagrams, so ProdLens keeps one consistent voice identity per role. */
const ROLE_VOICE: Record<string, string> = {
  persona: "Leda",
  agent: "Kore",
  judge: "Charon",
  guardrail: "Fenrir",
  component: "Puck",
};

const GEMINI_TTS_MODEL = "gemini-3.1-flash-tts-preview";

export class GeminiCastProvider implements TtsProvider {
  constructor(private style = "natural Indian English accent, warm and clear", private maxRetries = 5) {}
  async synth(text: string, actor: Actor | undefined, outPath: string): Promise<void> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY required for narration pregen");
    const voiceName = ROLE_VOICE[actor?.role ?? "component"] ?? "Kore";
    let res!: Response;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      res = await this.request(text, voiceName, key);
      if (res.status !== 429 && res.status < 500) break;
      const wait = 12000 * (attempt + 1);
      console.log(`[tts] HTTP ${res.status} - retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
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

  private request(text: string, voiceName: string, key: string): Promise<Response> {
    return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Speak in this style - ${this.style}: ${text}` }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } },
      }),
    });
  }

  voiceFor(actor: Actor | undefined): string {
    return ROLE_VOICE[actor?.role ?? "component"] ?? "Kore";
  }
}

/** macOS `say` fallback provider - real audio files with a distinct system
 *  voice per role (en-IN voices where installed). Used when the neural
 *  provider is quota-limited; NOT browser speechSynthesis. */
const SAY_ROLE_VOICE: Record<string, string> = {
  persona: "Tara",
  agent: "Rishi",
  judge: "Aman",
  guardrail: "Daniel",
  component: "Samantha",
};

/** Voicebox provider (github.com/jamiepine/voicebox): local MCP TTS at
 *  http://127.0.0.1:17493/mcp - zero-cost neural voices on the user's own
 *  machine, including cloned voices. Requires at least one voice profile in
 *  the Voicebox app; map roles to profile names via the constructor. */
export class VoiceboxProvider implements TtsProvider {
  private session: string | null = null;
  constructor(private roleProfiles: Record<string, string>, private base = "http://127.0.0.1:17493/mcp/") {}

  private async rpc(method: string, params?: unknown, id?: number): Promise<Record<string, unknown> | null> {
    const res = await fetch(this.base, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "X-Voicebox-Client-Id": "prodlens",
        ...(this.session ? { "mcp-session-id": this.session } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...(id !== undefined ? { id } : {}), method, params }),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.session = sid;
    const text = await res.text();
    const data = text.split("\n").find((l) => l.startsWith("data: "));
    return data ? (JSON.parse(data.slice(6)) as Record<string, unknown>) : null;
  }

  private async ensureSession(): Promise<void> {
    if (this.session) return;
    await this.rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "prodlens", version: "0.1" } }, 1);
    await this.rpc("notifications/initialized");
  }

  async synth(text: string, actor: Actor | undefined, outPath: string): Promise<void> {
    await this.ensureSession();
    const profile = this.voiceFor(actor);
    const r = (await this.rpc("tools/call", { name: "voicebox.speak", arguments: { text, profile, play: false } }, Date.now() % 1e6)) as never as { result?: { content?: Array<{ text?: string }> } };
    const payload = JSON.parse(r?.result?.content?.[0]?.text ?? "{}") as { generation_id?: string; id?: string };
    const genId = payload.generation_id ?? payload.id;
    if (!genId) throw new Error("voicebox.speak returned no generation id");
    // Poll the generation endpoint for the finished audio.
    const origin = new URL(this.base).origin;
    for (let i = 0; i < 60; i++) {
      const res = await fetch(`${origin}/generate/${genId}`, { headers: { "X-Voicebox-Client-Id": "prodlens" } });
      if (res.ok && (res.headers.get("content-type") ?? "").startsWith("audio")) {
        (await import("node:fs")).writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
        return;
      }
      await new Promise((rr) => setTimeout(rr, 1000));
    }
    throw new Error("voicebox generation timed out");
  }

  voiceFor(actor: Actor | undefined): string {
    return this.roleProfiles[actor?.role ?? "component"] ?? Object.values(this.roleProfiles)[0] ?? "default";
  }
}

export class SayProvider implements TtsProvider {
  async synth(text: string, actor: Actor | undefined, outPath: string): Promise<void> {
    const { execFile } = await import("node:child_process");
    const voice = this.voiceFor(actor);
    const aiff = outPath.replace(/\.wav$/, ".aiff");
    await new Promise<void>((resolve, reject) => execFile("say", ["-o", aiff, "-v", voice, "-r", "185", text], (e) => (e ? reject(e) : resolve())));
    // Chromium can't decode AIFF - convert to wav for Remotion playback.
    await new Promise<void>((resolve, reject) => execFile("ffmpeg", ["-y", "-i", aiff, "-ar", "24000", outPath], (e) => (e ? reject(e) : resolve())));
    (await import("node:fs")).rmSync(aiff, { force: true });
  }
  voiceFor(actor: Actor | undefined): string {
    return SAY_ROLE_VOICE[actor?.role ?? "component"] ?? "Samantha";
  }
}
