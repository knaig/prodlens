// Spec: v2 §12.2, §5.4 - see spec/traceability.md
// What a render will spend, worked out before it spends it.
//
// The pre-render ladder catches broken inputs and bad layout, but it could not
// see cost: a spec with three diagram scenes re-synthesized the trace
// narration once per scene, and the only evidence was a line in the render log
// AFTER the money was gone. This walks the scenes the way the renderer will
// and reports the TTS clips each one needs, split by whether the cache already
// holds them.
//
// Both TTS paths key on stable inputs, so both are cache-probed exactly. The
// browser path used to hash its generated tts-cmd, which no estimator could
// reproduce without re-running that generator; it now hashes a `ttsCmdKey`
// naming what the command means, which is the same thing synthCast keys on.
// `unknown` therefore stays empty in practice, and remains in the output for
// the one case that is genuinely unpredictable: a hand-written --tts-cmd.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ttsCacheDir } from "../llm/tts-cache.js";
import type { DemoSpec2, NarrationDoc, Scene2, VoiceSpec } from "./types.js";

export interface SceneCost {
  sceneId: string;
  kind: string;
  /** Clips this scene needs spoken. */
  clips: number;
  /** Of those, how many the cache already holds (undefined = not probeable). */
  cached?: number;
  note?: string;
}

export interface SpecEstimate {
  scenes: SceneCost[];
  /** Clips that will actually be synthesized and paid for. */
  newClips: number;
  /** Clips served from cache. */
  cachedClips: number;
  /** Clips whose cache state could not be determined here. */
  unknownClips: number;
  warnings: string[];
}

/** The synthCast cache key - kept in step with src/studio/tts.ts. */
function castCached(text: string, voice: VoiceSpec | undefined): boolean {
  const name = voice?.name ?? "Kore";
  const key = createHash("sha1").update(`${name}|${voice?.style ?? ""}|${text}`).digest("hex");
  return existsSync(join(ttsCacheDir(), `${key}.wav`));
}

/** The synthTts cache key - kept in step with src/execution/explain.ts.
 *  Predictable only because that path now keys on `ttsCmdKey`, a stable
 *  identity, rather than on the generated tts-cmd string. */
function browserCached(text: string, voice: VoiceSpec | undefined): boolean {
  const name = voice?.name ?? "Kore";
  const backend = (process.env.TTS_BACKEND || "auto").toLowerCase();
  const cmdIdentity = voice?.style ? `styled:${name}:${voice.style}` : "";
  const key = createHash("sha1").update(`${backend}|${cmdIdentity}|${name}|180|${text}`).digest("hex");
  return existsSync(join(ttsCacheDir(), key)); // synthTts stores without an extension
}

function viewOf(scene: Scene2): string {
  return scene.view ?? (scene.scenario ? "sequence" : "system");
}

function lineFor(narration: NarrationDoc, scene: Scene2): string | undefined {
  const id = scene.narrationIds?.[0];
  const line = narration.lines.find((l) => l.id === id) ?? narration.lines.find((l) => l.sceneId === scene.id);
  return line ? (narration.language && line.variants?.[narration.language]) || line.text : undefined;
}

export function estimateSpec(
  spec: DemoSpec2,
  narration: NarrationDoc,
  opts: { draft?: boolean; traceEvents?: number } = {},
): SpecEstimate {
  const scenes: SceneCost[] = [];
  const warnings: string[] = [];
  let speaksTrace = 0;

  for (const scene of spec.scenes) {
    if (opts.draft) {
      scenes.push({ sceneId: scene.id, kind: scene.type, clips: 0, cached: 0, note: "draft - silent" });
      continue;
    }

    if (scene.type === "diagram") {
      const view = viewOf(scene);
      if (view === "sequence") {
        speaksTrace++;
        const clips = opts.traceEvents ?? 0;
        scenes.push({
          sceneId: scene.id,
          kind: `diagram/${view}`,
          clips,
          // The trace is re-drafted before synthesis, so its wording - and
          // therefore its cache state - is not knowable until after the draft.
          note: clips ? "narration is re-drafted first, so these are re-synthesized" : "no prepared trace yet",
        });
      } else {
        const text = lineFor(narration, scene);
        scenes.push({
          sceneId: scene.id,
          kind: `diagram/${view}`,
          clips: 1,
          cached: text && castCached(text, spec.voice) ? 1 : 0,
          note: text ? undefined : view === "system" ? "opening is drafted at render time" : "no narration line - a default is used",
        });
      }
      continue;
    }

    if (scene.type === "call") {
      const spoken = (scene.turns ?? []).filter((t) => t.text);
      const cached = spoken.filter((t) => castCached(t.text!, spec.voice)).length;
      scenes.push({ sceneId: scene.id, kind: "call", clips: spoken.length, cached, note: `${spoken.length} spoken turn(s)` });
      continue;
    }

    const text = lineFor(narration, scene);
    scenes.push({
      sceneId: scene.id,
      kind: scene.type,
      clips: text ? 1 : 0,
      cached: text && browserCached(text, spec.voice) ? 1 : 0,
    });
  }

  if (speaksTrace > 1) {
    warnings.push(`${speaksTrace} scenes speak the trace - each one re-drafts and re-synthesizes it. Keep one sequence scene per render.`);
  }

  const cachedClips = scenes.reduce((s, r) => s + (r.cached ?? 0), 0);
  const unknownClips = scenes.reduce((s, r) => s + (r.cached === undefined ? r.clips : 0), 0);
  const newClips = scenes.reduce((s, r) => s + (r.cached === undefined ? 0 : r.clips - (r.cached ?? 0)), 0);
  return { scenes, newClips, cachedClips, unknownClips, warnings };
}

/** One line per scene, for the render log. Printed before any work starts so
 *  an unexpected number is seen while it still costs nothing to stop. */
export function formatEstimate(e: SpecEstimate): string[] {
  const out = e.scenes.map((s) => {
    const cache = s.cached === undefined ? (s.clips ? `${s.clips} clip(s), cache unknown` : "silent") : `${s.clips} clip(s), ${s.cached} cached`;
    return `  ${s.sceneId.padEnd(14)} ${s.kind.padEnd(20)} ${cache}${s.note ? ` - ${s.note}` : ""}`;
  });
  out.push(`  total: ${e.newClips} to synthesize, ${e.cachedClips} cached, ${e.unknownClips} unknown`);
  for (const w of e.warnings) out.push(`  WARNING: ${w}`);
  return out;
}
