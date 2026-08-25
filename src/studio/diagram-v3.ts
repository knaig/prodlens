// Spec: v2 §5.4 (D-DIAGV3-1) - see spec/traceability.md
// Studio bridge to the diagrams/ v3 renderers (elkjs layout + Remotion export).
//
// The v3 renderers were built but never reachable from the pipeline: studio
// diagram scenes used the legacy in-page SVG renderer, so every shipped video
// carried clipped boxes and mid-word truncation while the good renderer sat
// unused behind a hand-written fixture. This module makes a diagram scene
// render through v3, keeping renderDiagramScene's contract so render.ts's
// segment loop is unchanged.
//
// It shells out rather than importing: diagrams/ is a separate workspace with
// its own node_modules, React version, and tsconfig. Spawning `tsx`/`remotion`
// inside it is what keeps that boundary intact.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Respec } from "../respec/respec.js";
import type { SceneChoreography } from "./types.js";

/** <repo>/diagrams - this file is <repo>/src/studio/ or <repo>/dist/studio/. */
export function diagramsRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "diagrams");
}

/** Whether the v3 workspace can actually run. Checked before routing to it so
 *  a missing install degrades to the legacy renderer instead of failing. */
export function v3Available(): { ok: boolean; reason?: string } {
  const root = diagramsRoot();
  if (!existsSync(root)) return { ok: false, reason: "diagrams/ workspace not present" };
  if (!existsSync(join(root, "node_modules"))) return { ok: false, reason: "diagrams/ dependencies not installed (npm i in diagrams/)" };
  if (!existsSync(join(root, "src", "export", "index.ts"))) return { ok: false, reason: "diagrams/src/export/index.ts missing" };
  return { ok: true };
}

interface NarrationManifest {
  traceTitle: string;
  items: Array<{ index: number; file: string; durationSec: number; text: string; voice?: string }>;
}
interface PreparedTrace {
  title: string;
  actors: Array<{ id: string }>;
  events: Array<{ from: string; to: string; label: string; narration?: string }>;
}

function run(cwd: string, cmd: string, args: string[], env?: Record<string, string>): Promise<string> {
  return new Promise((res, rej) => {
    execFile(cmd, args, { cwd, maxBuffer: 1024 * 1024 * 32, env: { ...process.env, ...env } }, (err, stdout, stderr) => {
      if (err) rej(new Error(`${cmd} ${args[0]} failed: ${(stderr || err.message).slice(0, 400)}`));
      else res(stdout);
    });
  });
}

/** Project a respec into the renderers' input files. Cheap, offline, and the
 *  first rung of the verification ladder - run this alone to confirm the graph
 *  before paying for anything. */
export async function prepareV3Data(respec: Respec, scenarioName?: string): Promise<{ nodes: number; edges: number; events: number; title: string }> {
  const root = diagramsRoot();
  const tmp = join(root, ".respec-input.json");
  writeFileSync(tmp, JSON.stringify(respec));
  const args = ["tsx", "src/export/prepare.ts", tmp];
  if (scenarioName) args.push(scenarioName);
  await run(root, "npx", args);

  const graph = JSON.parse(readFileSync(join(root, "public", "data", "structural.json"), "utf-8")) as { nodes: unknown[]; edges: unknown[] };
  const tracePath = join(root, "public", "data", "trace.json");
  const trace = existsSync(tracePath) ? (JSON.parse(readFileSync(tracePath, "utf-8")) as PreparedTrace) : undefined;
  return { nodes: graph.nodes.length, edges: graph.edges.length, events: trace?.events.length ?? 0, title: trace?.title ?? "" };
}

function manifestPath(): string {
  return join(diagramsRoot(), "public", "narration", "manifest.json");
}

/** Is the existing narration manifest still the right one for the prepared
 *  trace? Narration is the expensive step, so never re-synthesize on a whim -
 *  a stale manifest is one whose title or clip count no longer matches. */
export function narrationState(): { present: boolean; matches: boolean; clips: number; totalSec: number; reason?: string } {
  const mp = manifestPath();
  if (!existsSync(mp)) return { present: false, matches: false, clips: 0, totalSec: 0, reason: "no manifest" };
  const m = JSON.parse(readFileSync(mp, "utf-8")) as NarrationManifest;
  const totalSec = m.items.reduce((s, i) => s + i.durationSec, 0);
  const tracePath = join(diagramsRoot(), "public", "data", "trace.json");
  if (!existsSync(tracePath)) return { present: true, matches: false, clips: m.items.length, totalSec, reason: "no prepared trace to compare against" };
  const t = JSON.parse(readFileSync(tracePath, "utf-8")) as PreparedTrace;
  if (m.traceTitle !== t.title) return { present: true, matches: false, clips: m.items.length, totalSec, reason: `manifest is for "${m.traceTitle}", trace is "${t.title}"` };
  if (m.items.length !== t.events.length) return { present: true, matches: false, clips: m.items.length, totalSec, reason: `manifest has ${m.items.length} clips for ${t.events.length} events` };
  // Title and count can both match while the words have changed - rewriting
  // the narration is exactly that case. Comparing the spoken text is what
  // stops a re-drafted script being played with the previous recording.
  const changed = t.events.findIndex((e, i) => (e.narration ?? e.label) !== m.items[i]?.text);
  if (changed >= 0) return { present: true, matches: false, clips: m.items.length, totalSec, reason: `narration text changed at line ${changed + 1}` };
  return { present: true, matches: true, clips: m.items.length, totalSec };
}

/** Rewrite the prepared trace's narration as something a person would say.
 *
 *  The adapter fills each hop with `"<from> to <to>: <action>."` - correct,
 *  and unlistenable: it reads component names aloud and states the obvious in
 *  the same shape twelve times running. This drafts an opening that frames
 *  what the system is and why the flow matters, then one line per hop that
 *  says what is happening and why, in continuous prose.
 *
 *  Grounded in the respec: the model is given the components and their roles
 *  and told to describe only those, so the narration stays checkably true.
 *  Returns the opening for the caller to use over the system map. */
export async function draftTraceNarration(
  respec: Respec,
  opts: { register?: string } = {},
): Promise<{ opening: string; rewritten: number } | undefined> {
  const tracePath = join(diagramsRoot(), "public", "data", "trace.json");
  if (!existsSync(tracePath)) return undefined;
  const { isLlmConfigured, localChat } = await import("../llm/local.js");
  if (!isLlmConfigured()) return undefined;

  const trace = JSON.parse(readFileSync(tracePath, "utf-8")) as PreparedTrace & { events: Array<{ narration?: string }> };
  const res = await localChat({
    system:
      "You narrate architecture walkthroughs for engineers. You are given a real system and one real flow through it. " +
      "Write narration that a person would actually say out loud - continuous, plain, and specific. " +
      "Never say 'X to Y'. Never repeat the same sentence shape twice in a row. " +
      "Component ids are code identifiers, not names anyone says out loud: turn them into natural English " +
      "('voice_2_voice_server' becomes 'the voice server', 'ai4bharat_stt_server' becomes 'the Indic speech-to-text server', " +
      "'voicera_backend' becomes 'the backend'). Introduce a component the first time it appears, then refer to it briefly. " +
      "This is spoken aloud, so no underscores, no camelCase, no file paths. " +
      "Describe only what the given components and steps support; invent nothing.",
    text: [
      `System: ${respec.oneLiner}`,
      opts.register ? `Register: ${opts.register}` : "",
      "",
      "Components:",
      ...respec.topology.map((c) => `- ${c.name} (${c.kind}): ${c.role}`),
      "",
      `Flow: ${trace.title}`,
      ...trace.events.map((e, i) => `${i + 1}. ${e.from} -> ${e.to}: ${e.label}`),
      "",
      "Write:",
      "- opening: 2-3 sentences framing what this system is and what this flow shows. Spoken over a diagram of the whole system.",
      `- hops: exactly ${trace.events.length} lines, one per numbered step above, in order. One or two sentences each.`,
      "  Say what is happening and why it matters. Vary the phrasing. Refer to components naturally, the way an engineer would in conversation.",
    ].filter(Boolean).join("\n"),
    tool: {
      name: "emit_narration",
      description: "Emit the spoken narration for this architecture walkthrough.",
      inputSchema: {
        type: "object",
        properties: {
          opening: { type: "string" },
          hops: { type: "array", items: { type: "string" }, minItems: trace.events.length, maxItems: trace.events.length },
        },
        required: ["opening", "hops"],
      },
    },
    maxTokens: 2400,
  });

  const out = res.toolInput as { opening?: string; hops?: string[] } | undefined;
  if (!out?.hops?.length) return undefined;
  // A short answer is better than a wrong one: keep the mechanical line for any
  // hop the model did not cover rather than shifting every line by one.
  trace.events.forEach((e, i) => {
    const line = out.hops?.[i]?.trim();
    if (line) e.narration = line;
  });
  writeFileSync(tracePath, JSON.stringify(trace, null, 2));
  return { opening: (out.opening ?? "").trim(), rewritten: Math.min(out.hops.length, trace.events.length) };
}

/** Synthesize narration for the prepared trace. Skipped when the manifest
 *  already matches - the TTS clip cache makes a repeat cheap, but not free. */
export async function ensureNarration(force = false): Promise<{ ran: boolean; clips: number; totalSec: number }> {
  const before = narrationState();
  if (!force && before.matches) return { ran: false, clips: before.clips, totalSec: before.totalSec };
  await run(diagramsRoot(), "npx", ["tsx", "src/narration/pregen.ts"]);
  const after = narrationState();
  return { ran: true, clips: after.clips, totalSec: after.totalSec };
}

/** Render the structural map as a single still. Seconds, no narration, no
 *  video encode - the cheapest way to see whether a respec lays out sensibly. */
export async function renderStructuralStill(outPng: string): Promise<string> {
  const abs = resolve(outPng);
  mkdirSync(dirname(abs), { recursive: true });
  await run(diagramsRoot(), "npx", ["remotion", "still", "src/export/index.ts", "StructuralMap", abs, "--log=error"]);
  return abs;
}

export interface V3SceneResult {
  mp4: string;
  durationSec: number;
  choreography: SceneChoreography;
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    execFile("ffmpeg", args, { maxBuffer: 1024 * 1024 * 16 }, (err, _o, stderr) => {
      if (err) rej(new Error(`ffmpeg failed: ${(stderr || err.message).slice(0, 300)}`));
      else res();
    });
  });
}

/** The v3 compositions a diagram scene can ask for. `system` is the animated
 *  map, `sequence` the animated flow; the rest are static views that answer a
 *  different question about the same respec. */
export const DIAGRAM_VIEWS = {
  system: "StructuralReveal",
  sequence: "SequenceCall",
  deployment: "DeploymentMap",
  activity: "ActivityFlow",
  "state-machine": "StateMachineAggregate",
} as const;
export type DiagramView = keyof typeof DIAGRAM_VIEWS;

/** A static view held under one narration line. Deployment, activity and the
 *  state-machine aggregate have no time axis - the v3 brief is explicit that
 *  they should not have a camera moved over them to manufacture one - so they
 *  render as a still and hold for as long as the sentence describing them. */
export async function renderStillClip(opts: {
  view: Exclude<DiagramView, "system" | "sequence">;
  sceneId: string;
  narrate: string;
  voice?: import("./types.js").VoiceSpec;
  outMp4: string;
  staging: string;
  silent?: boolean;
}): Promise<V3SceneResult> {
  const abs = resolve(opts.outMp4);
  mkdirSync(opts.staging, { recursive: true });
  mkdirSync(dirname(abs), { recursive: true });

  const png = join(opts.staging, `${opts.sceneId}.png`);
  await run(diagramsRoot(), "npx", ["remotion", "still", "src/export/index.ts", DIAGRAM_VIEWS[opts.view], resolve(png), "--log=error"]);

  let durationSec = 6;
  let wav: string | undefined;
  if (!opts.silent) {
    const { synthCast } = await import("./tts.js");
    const { probeDuration } = await import("../execution/explain.js");
    wav = join(opts.staging, `${opts.sceneId}.wav`);
    await synthCast(opts.narrate, opts.voice, wav);
    durationSec = (await probeDuration(wav).catch(() => 0)) + 0.8;
  }

  const args = ["-y", "-loop", "1", "-framerate", "30", "-i", png];
  if (wav) args.push("-i", wav);
  args.push("-t", String(durationSec), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-vf", "scale=1280:-2",
    ...(wav ? ["-c:a", "aac", "-shortest"] : ["-an"]), abs);
  await ffmpeg(args);
  if (!existsSync(abs)) throw new Error(`ffmpeg reported success but wrote no file: ${abs}`);

  return {
    mp4: abs,
    durationSec,
    choreography: {
      sceneId: opts.sceneId,
      durationSec,
      tracks: {
        narration: opts.silent ? [] : [{ at: 0, lineId: opts.sceneId, dur: durationSec, text: opts.narrate }],
        cursor: [], animation: [], camera: [],
      },
    },
  };
}

/** A still diagram held under one narration line, as a video segment.
 *
 *  The animated sequence view answers "what happens when"; an overview answers
 *  "what is this thing", and needs no motion to do it. Rendering it as a still
 *  and holding it for the length of its narration costs one image and one TTS
 *  clip, instead of a full animated encode - which is what makes it affordable
 *  to alternate architecture with live UI rather than choosing one. */
export async function renderStructuralClip(opts: {
  sceneId: string;
  narrate: string;
  voice?: import("./types.js").VoiceSpec;
  outMp4: string;
  staging: string;
  silent?: boolean;
}): Promise<V3SceneResult> {
  const abs = resolve(opts.outMp4);
  mkdirSync(opts.staging, { recursive: true });
  mkdirSync(dirname(abs), { recursive: true });

  // Narration first: its measured length is what the reveal is paced against,
  // so the map finishes building as the sentence describing it finishes.
  let durationSec = 6;
  let wav: string | undefined;
  if (!opts.silent) {
    const { synthCast } = await import("./tts.js");
    const { probeDuration } = await import("../execution/explain.js");
    wav = join(opts.staging, `${opts.sceneId}.wav`);
    await synthCast(opts.narrate, opts.voice, wav);
    durationSec = (await probeDuration(wav).catch(() => 0)) + 0.8; // a breath at the end
  }

  const silentMp4 = join(opts.staging, `${opts.sceneId}-silent.mp4`);
  await run(diagramsRoot(), "npx", [
    "remotion", "render", "src/export/index.ts", "StructuralReveal", resolve(silentMp4),
    "--props", JSON.stringify({ durationSec }),
    "--log=error",
  ]);

  const args = ["-y", "-i", silentMp4];
  if (wav) args.push("-i", wav);
  args.push(
    "-t", String(durationSec),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-vf", "scale=1280:-2",
    ...(wav ? ["-c:a", "aac", "-shortest"] : ["-an"]),
    abs,
  );
  await ffmpeg(args);
  if (!existsSync(abs)) throw new Error(`ffmpeg reported success but wrote no file: ${abs}`);

  return {
    mp4: abs,
    durationSec,
    choreography: {
      sceneId: opts.sceneId,
      durationSec,
      tracks: {
        narration: opts.silent ? [] : [{ at: 0, lineId: opts.sceneId, dur: durationSec, text: opts.narrate }],
        cursor: [], animation: [], camera: [],
      },
    },
  };
}

/** Render the animated sequence diagram for the prepared trace.
 *  `frames` renders only a slice (e.g. "0-90") - a motion smoke test that
 *  costs a couple of seconds instead of a full encode. */
export async function renderSequenceV3(opts: {
  sceneId: string;
  outMp4: string;
  frames?: string;
}): Promise<V3SceneResult> {
  const abs = resolve(opts.outMp4);
  mkdirSync(dirname(abs), { recursive: true });
  const args = ["remotion", "render", "src/export/index.ts", "SequenceCall", abs, "--log=error"];
  if (opts.frames) args.push(`--frames=${opts.frames}`);
  await run(diagramsRoot(), "npx", args);
  if (!existsSync(abs)) throw new Error(`remotion reported success but wrote no file: ${abs}`);

  // Choreography from the manifest: the same measured durations that drove the
  // render, so the emitted contract matches what is on screen.
  const m = JSON.parse(readFileSync(manifestPath(), "utf-8")) as NarrationManifest;
  let at = 0;
  const narration = m.items.map((i) => {
    const entry = { at, lineId: `${opts.sceneId}-${i.index}`, dur: i.durationSec, text: i.text };
    at += i.durationSec;
    return entry;
  });
  return {
    mp4: abs,
    durationSec: at,
    choreography: { sceneId: opts.sceneId, durationSec: at, tracks: { narration, cursor: [], animation: [], camera: [] } },
  };
}
