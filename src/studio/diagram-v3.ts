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
  return { present: true, matches: true, clips: m.items.length, totalSec };
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
