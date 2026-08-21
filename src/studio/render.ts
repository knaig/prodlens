// DemoSpec2 renderer (spec v2 §4): scenes -> segments -> one MP4, with
// narration.json + choreography.json emitted as first-class artifacts.
// Browser scenes (card/login/screen/call) compile to the proven DemoScript
// renderer; diagram scenes render on the animated SVG engine; segments concat.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { renderProductDemo, type DemoScript, type DemoStep } from "../execution/demo.js";
import { probeDuration } from "../execution/explain.js";
import type { Respec } from "../respec/respec.js";
import { renderDiagramScene, renderSequenceScene } from "./diagram.js";
import { audienceById, type DemoSpec2, type NarrationDoc, type Scene2, type SceneChoreography } from "./types.js";
import { spawn } from "node:child_process";

export interface RenderInputs {
  spec: DemoSpec2;
  narration: NarrationDoc;
  respec?: Respec;
  outMp4: string;
  auth: import("../discovery/auth.js").AuthConfig;
  dataDir: string;
  /** Skip TTS - silent draft for the render-review gate. */
  draft?: boolean;
  onProgress?: (line: string) => void;
}

export interface RenderResult {
  videoPath: string;
  choreographyPath: string;
  narrationPath: string;
  skipped: Array<{ sceneId: string; reason: string }>;
  segments: number;
}

type Segment =
  | { kind: "browser"; scenes: Scene2[] }
  | { kind: "diagram"; scene: Scene2 };

function lineFor(narration: NarrationDoc, scene: Scene2): string | undefined {
  const id = scene.narrationIds?.[0];
  const line = narration.lines.find((l) => l.id === id) ?? narration.lines.find((l) => l.sceneId === scene.id);
  if (!line) return undefined;
  const lang = narration.language;
  return (lang && line.variants?.[lang]) || line.text;
}

function sceneToSteps(scene: Scene2, narration: NarrationDoc, auth: RenderInputs["auth"]): DemoStep[] {
  const narrate = lineFor(narration, scene);
  if (scene.type === "login") {
    // Credentials typed on camera (spec PM1/§4.1): the password field is a real
    // <input type=password>, so the app masks it on screen by itself.
    const fill: Record<string, string> = {};
    if (auth.email) fill["#email, input[name='email'], input[type='email']"] = auth.email;
    if (auth.password) fill["#password, input[name='password'], input[type='password']"] = auth.password;
    return [
      { name: scene.id + "-open", goto: auth.signInPath ?? "/", narrate, scroll: false, settleMs: 2500 },
      { name: scene.id + "-signin", fill, click: "Sign in", clickTimeoutMs: 12000, scroll: false, settleMs: scene.settleMs ?? 5000, optional: true },
    ];
  }
  if (scene.type === "call") {
    const steps: DemoStep[] = [{ name: scene.id + "-open", goto: scene.agentPath ?? "/", narrate, scroll: false, settleMs: 4000 }];
    if (scene.startClick) steps.push({ name: scene.id + "-start", click: scene.startClick, scroll: false, settleMs: 1500, optional: true });
    const turns = Math.max(1, scene.micWav?.length ?? 1);
    steps.push({ name: scene.id + "-conversation", scroll: false, settleMs: (scene.turnGapMs ?? 9000) * turns });
    if (scene.endClick) steps.push({ name: scene.id + "-end", click: scene.endClick, scroll: false, settleMs: 1200, optional: true });
    return steps;
  }
  // screen (and artifact-as-screen: show the artifact's page/screenshot path)
  return [
    {
      name: scene.id,
      goto: scene.goto,
      click: scene.click,
      fill: scene.fill,
      narrate,
      scroll: scene.scroll ?? false,
      settleMs: scene.settleMs ?? 6000,
      optional: scene.optional,
    },
  ];
}

export async function renderSpec(inputs: RenderInputs): Promise<RenderResult> {
  const { spec, narration } = inputs;
  const outDir = dirname(inputs.outMp4);
  const staging = join(outDir, ".studio-staging");
  mkdirSync(staging, { recursive: true });
  const log = inputs.onProgress ?? ((l: string) => console.log(l));
  const skipped: Array<{ sceneId: string; reason: string }> = [];
  const choreographies: SceneChoreography[] = [];

  // ---- partition scenes into segments ----
  const segments: Segment[] = [];
  for (const scene of spec.scenes) {
    if (scene.type === "diagram") {
      if (!inputs.respec || !inputs.respec.topology.length) {
        skipped.push({ sceneId: scene.id, reason: "diagram scene needs a respec - run the respec stage first" });
        continue;
      }
      segments.push({ kind: "diagram", scene });
      continue;
    }
    if (scene.type === "call" && !scene.micWav?.length) {
      // A call scene without caller audio can still run (agent greets), but warn.
      log(`[studio] call scene ${scene.id} has no micWav - the agent side will carry the conversation`);
    }
    if (scene.type === "artifact" && !scene.goto && !scene.artifactRel) {
      skipped.push({ sceneId: scene.id, reason: "artifact scene has no goto/artifactRel" });
      continue;
    }
    const last = segments[segments.length - 1];
    if (last?.kind === "browser") last.scenes.push(scene);
    else segments.push({ kind: "browser", scenes: [scene] });
  }

  // ---- render each segment ----
  const parts: string[] = [];
  let si = 0;
  for (const seg of segments) {
    si++;
    if (seg.kind === "diagram") {
      const scene = seg.scene;
      const tier = scene.tier ?? "summary";
      log(`[studio] segment ${si}: diagram (${tier}${scene.mode === "cast" ? ", cast" : ""})`);
      try {
        const res = await renderDiagramScene({
          sceneId: scene.id,
          respec: inputs.respec!,
          tier,
          scenarioName: scene.scenario,
          mode: scene.mode,
          voice: inputs.draft ? undefined : spec.voice,
          audienceRegister: audienceById(spec.audience)?.register,
          outMp4: join(staging, `seg-${si}.mp4`),
          staging: join(staging, `dg-${si}`),
        });
        choreographies.push(res.choreography);
        parts.push(res.mp4);
        // Dynamic diagram switching (spec 13.2): tutorial-tier scenario beats
        // continue into an animated sequence diagram of the same flow.
        if (tier === "tutorial" && scene.scenario && inputs.respec!.flows.length) {
          log(`[studio] segment ${si}b: sequence diagram (${scene.scenario})`);
          const seq = await renderSequenceScene({
            sceneId: scene.id + "-seq",
            respec: inputs.respec!,
            scenarioName: scene.scenario,
            voice: inputs.draft ? undefined : spec.voice,
            audienceRegister: audienceById(spec.audience)?.register,
            outMp4: join(staging, `seg-${si}b.mp4`),
            staging: join(staging, `sq-${si}`),
          });
          choreographies.push(seq.choreography);
          parts.push(seq.mp4);
        }
      } catch (e) {
        skipped.push({ sceneId: scene.id, reason: `diagram render failed: ${e instanceof Error ? e.message : e}` });
      }
      continue;
    }

    // browser segment
    const scenes = seg.scenes;
    const first = scenes[0];
    const intro = first.type === "card" ? { title: first.title ?? spec.title, tagline: first.tagline, narrate: lineFor(narration, first) } : undefined;
    const stepScenes = intro ? scenes.slice(1) : scenes;
    if (!stepScenes.length && !intro) continue;
    const steps = stepScenes.flatMap((s) => (s.type === "card"
      ? [{ name: s.id, narrate: lineFor(narration, s), scroll: false as const, settleMs: 2500 }]
      : sceneToSteps(s, narration, inputs.auth)));
    const callScene = stepScenes.find((s) => s.type === "call");
    const script: DemoScript = {
      title: spec.title,
      baseUrl: spec.baseUrl,
      entry: stepScenes.find((s) => s.goto)?.goto ?? "/",
      viewport: spec.viewport ?? { width: 1440, height: 860 },
      voice: spec.voice?.name ?? "Kore",
      intro,
      steps,
      autoNarrate: false,
      scroll: false,
      fakeMicWav: callScene?.micWav?.[0],
    };
    log(`[studio] segment ${si}: browser (${stepScenes.map((s) => s.type).join(",")})`);
    const segOut = join(staging, `seg-${si}.mp4`);
    const result = await renderProductDemo(script, segOut, {
      auth: inputs.auth,
      screenshotsDir: join(staging, `shots-${si}`),
      noVoice: inputs.draft ?? false,
      noCaptions: false,
      ttsCmd: spec.voice?.style ? styledTtsCmd(spec.voice.name ?? "Kore", spec.voice.style) : undefined,
    });
    if (result.error) log(`[studio] segment ${si} finished with note: ${result.error}`);
    parts.push(inputs.draft && result.silentVideoPath ? result.silentVideoPath : result.videoPath);
    // Browser choreography from the emitted screenplay.
    if (result.screenplayPath && existsSync(result.screenplayPath)) {
      try {
        const sp = JSON.parse(readFileSync(result.screenplayPath, "utf-8")) as { scenes?: Array<{ name?: string; startSec?: number; durSec?: number; narration?: string }> };
        for (const sc of sp.scenes ?? []) {
          choreographies.push({
            sceneId: sc.name ?? `seg-${si}`,
            durationSec: sc.durSec ?? 0,
            tracks: {
              narration: sc.narration ? [{ at: sc.startSec ?? 0, lineId: sc.name ?? "", dur: sc.durSec ?? 0, text: sc.narration }] : [],
              cursor: [], animation: [], camera: [],
            },
          });
        }
      } catch { /* screenplay shape drifted - non-fatal */ }
    }
  }

  if (!parts.length) throw new Error(`nothing rendered - ${skipped.length} scene(s) skipped: ${skipped.map((s) => s.reason).join("; ")}`);

  // ---- concat ----
  if (parts.length === 1) {
    await copyFile(parts[0], inputs.outMp4);
  } else {
    await concatMp4(parts, inputs.outMp4);
  }

  const narrationPath = join(outDir, "narration.json");
  const choreographyPath = join(outDir, "choreography.json");
  writeFileSync(narrationPath, JSON.stringify(narration, null, 2));
  writeFileSync(choreographyPath, JSON.stringify(choreographies, null, 2));
  rmSync(staging, { recursive: true, force: true });
  log(`[studio] final video: ${inputs.outMp4} (${parts.length} segment(s), ${skipped.length} skipped)`);
  return { videoPath: inputs.outMp4, choreographyPath, narrationPath, skipped, segments: parts.length };
}

/** Style prompts ride the demo renderer's tts-cmd hook via a tiny inline node
 *  script (kept dependency-free; mirrors studio/tts.ts synthCast). */
function styledTtsCmd(voice: string, style: string): string {
  const js = `
const t = process.env.TTS_TEXT, o = process.env.TTS_OUT, k = process.env.GEMINI_API_KEY;
if (!t || !o || !k) process.exit(1);
const body = { contents: [{ parts: [{ text: "Speak in this style - " + ${JSON.stringify(style)} + ": " + t }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: ${JSON.stringify(voice)} } } } } };
const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent", { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": k }, body: JSON.stringify(body) });
if (!res.ok) process.exit(1);
const j = await res.json();
const p = j?.candidates?.[0]?.content?.parts?.find((x) => x.inlineData?.data);
if (!p) process.exit(1);
const pcm = Buffer.from(p.inlineData.data, "base64");
const rate = Number(/rate=(\\d+)/.exec(p.inlineData.mimeType ?? "")?.[1] ?? 24000);
const h = Buffer.alloc(44);
h.write("RIFF",0);h.writeUInt32LE(36+pcm.length,4);h.write("WAVE",8);h.write("fmt ",12);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(rate,24);h.writeUInt32LE(rate*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write("data",36);h.writeUInt32LE(pcm.length,40);
require("node:fs").writeFileSync(o, Buffer.concat([h, pcm]));
`.trim();
  const b64 = Buffer.from(`(async()=>{${js}})()`).toString("base64");
  return `node -e "eval(Buffer.from('${b64}','base64').toString())"`;
}

async function concatMp4(parts: string[], outPath: string): Promise<void> {
  const inputs = parts.flatMap((p) => ["-i", p]);
  const n = parts.length;
  const filter =
    parts.map((_, i) => `[${i}:v]scale=1280:-2,setsar=1,fps=30,format=yuv420p[v${i}];[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}];`).join("") +
    parts.map((_, i) => `[v${i}][a${i}]`).join("") +
    `concat=n=${n}:v=1:a=1[v][a]`;
  await ffmpeg(["-y", ...inputs, "-filter_complex", filter, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", outPath]);
}

async function copyFile(src: string, dst: string): Promise<void> {
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, readFileSync(src));
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-600)}`))));
  });
}

export function durationOf(path: string): Promise<number> {
  return probeDuration(path);
}
