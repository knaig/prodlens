#!/usr/bin/env node
// Spec: v2 §5.4, §12.2 - see spec/traceability.md
// Pre-render checklist. Rendering is the expensive step - a narrated diagram
// scene costs minutes of wall time and real TTS spend - so every rung below
// runs WITHOUT producing a video, and each one is cheaper than the next.
//
//   npm run render:check [-- <respec/spec.json> [flow name]]
//
// Rungs:
//   1. environment  - ffmpeg, playwright browsers, the diagrams/ workspace
//   2. inputs       - respec present, has topology + the named flow
//   3. projection   - respec -> graph/trace, reporting nodes/edges/events
//   4. narration    - does the manifest match the trace, and what would it cost
//   5. estimate     - projected video length, wall time, and spend
//
// Exits non-zero if anything would make a render fail, so it can gate CI.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const diagrams = join(root, "diagrams");
const respecPath = process.argv[2] ?? "data/projects/voicera-live/respec/spec.json";
const flowName = process.argv[3];

const problems = [];
const warnings = [];
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => { problems.push(m); console.log(`  FAIL  ${m}`); };
const warn = (m) => { warnings.push(m); console.log(`  warn  ${m}`); };

function has(cmd) {
  try { execFileSync("which", [cmd], { stdio: "pipe" }); return true; } catch { return false; }
}

console.log("\n1. environment");
has("ffmpeg") ? ok("ffmpeg") : bad("ffmpeg not on PATH - no video can be muxed");
has("ffprobe") ? ok("ffprobe") : bad("ffprobe not on PATH - clip durations cannot be measured");
existsSync(join(process.env.HOME ?? "", "Library/Caches/ms-playwright"))
  ? ok("playwright browsers installed")
  : warn("playwright browser cache not found - browser scenes will need `npx playwright install`");
if (!existsSync(diagrams)) bad("diagrams/ workspace missing - diagram scenes fall back to the legacy renderer");
else if (!existsSync(join(diagrams, "node_modules"))) bad("diagrams/ dependencies not installed - run `npm i` in diagrams/");
else ok("diagrams/ v3 workspace ready (elkjs + Remotion)");

console.log("\n2. inputs");
const abs = resolve(root, respecPath);
let respec;
if (!existsSync(abs)) {
  bad(`respec not found at ${respecPath} - run the respec stage first`);
} else {
  respec = JSON.parse(readFileSync(abs, "utf-8"));
  const comps = respec.topology?.length ?? 0;
  const flows = respec.flows?.length ?? 0;
  comps ? ok(`respec: ${comps} components, ${flows} flow(s)`) : bad("respec has no topology - nothing to draw");
  if (flowName) {
    respec.flows?.some((f) => f.name === flowName)
      ? ok(`flow "${flowName}" found`)
      : bad(`flow "${flowName}" not in the respec (have: ${(respec.flows ?? []).map((f) => f.name).join(", ") || "none"})`);
  }
  if (!flows) warn("respec has no flows - a sequence scene cannot be built");
}

console.log("\n3. projection (offline, free)");
let prep;
if (respec && !problems.length) {
  try {
    const args = ["tsx", "src/export/prepare.ts", abs];
    if (flowName) args.push(flowName);
    const out = execFileSync("npx", args, { cwd: diagrams, encoding: "utf-8", stdio: "pipe" });
    out.trim().split("\n").forEach((l) => ok(l.trim()));
    const g = JSON.parse(readFileSync(join(diagrams, "public/data/structural.json"), "utf-8"));
    prep = { nodes: g.nodes.length, edges: g.edges.length };
    const orphans = g.nodes.filter((n) => !g.edges.some((e) => e.from === n.id || e.to === n.id));
    if (orphans.length) warn(`${orphans.length} unconnected node(s): ${orphans.map((n) => n.id).join(", ")}`);
    const truncated = g.nodes.filter((n) => (n.sublabel ?? "").endsWith("…")).length;
    if (truncated) warn(`${truncated} sublabel(s) trimmed for width (word-boundary, not mid-word)`);
  } catch (e) {
    bad(`projection failed: ${String(e.message).slice(0, 200)}`);
  }
} else {
  console.log("  skipped (inputs not usable)");
}

console.log("\n4. narration");
const manifestPath = join(diagrams, "public/narration/manifest.json");
const tracePath = join(diagrams, "public/data/trace.json");
let clipsNeeded = 0;
let reuse = false;
if (existsSync(tracePath)) {
  const trace = JSON.parse(readFileSync(tracePath, "utf-8"));
  clipsNeeded = trace.events.length;
  if (!existsSync(manifestPath)) {
    warn(`no narration manifest - a render would synthesize ${clipsNeeded} clip(s)`);
  } else {
    const m = JSON.parse(readFileSync(manifestPath, "utf-8"));
    if (m.traceTitle === trace.title && m.items.length === trace.events.length) {
      reuse = true;
      ok(`manifest matches the trace: ${m.items.length} clips, ${m.items.reduce((s, i) => s + i.durationSec, 0).toFixed(1)}s (no TTS spend)`);
    } else {
      warn(`manifest is stale (${m.items.length} clips for "${m.traceTitle}") - ${clipsNeeded} clip(s) would be re-synthesized`);
    }
  }
  // The clip cache is what makes a re-synthesis cheap; say whether it is warm.
  const cache = process.env.PRODLENS_TTS_CACHE || join(root, "data/tts-cache");
  existsSync(cache)
    ? ok(`tts cache present at ${cache.replace(root + "/", "")}`)
    : warn("tts cache absent - every clip will be paid for");
} else {
  console.log("  skipped (no prepared trace)");
}

console.log("\n5. estimate");
if (existsSync(manifestPath) && reuse) {
  const m = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const sec = m.items.reduce((s, i) => s + i.durationSec, 0);
  console.log(`  video length      ~${sec.toFixed(0)}s`);
  console.log(`  render wall time  ~${Math.ceil(sec * 1.3)}s (Remotion encode, no live recording)`);
  console.log(`  llm spend         ~$0.0004 (one batched narration draft)`);
  // The manifest matching only means it matches the text prepare.ts just
  // wrote. A studio render re-drafts that narration into spoken prose first,
  // which changes the words and therefore invalidates these clips - so quoting
  // $0.00 here would be the estimate lying about the one cost that matters.
  if (process.env.LLM_API_KEY || process.env.LLM_BASE_URL) {
    console.log(`  tts spend         ${m.items.length} clip(s) - a studio render re-drafts the narration first, so these clips are re-synthesized`);
    console.log(`                    (cache absorbs any line whose wording is unchanged)`);
  } else {
    console.log(`  tts spend         $0.00 (manifest reused; no LLM configured, so narration is not re-drafted)`);
  }
} else if (clipsNeeded) {
  console.log(`  video length      unknown until narration is measured (~${clipsNeeded} clips)`);
  console.log(`  tts spend         ${clipsNeeded} clip(s) on a cold cache`);
}

console.log(`\n${problems.length ? `BLOCKED: ${problems.length} problem(s)` : "READY to render"}${warnings.length ? ` (${warnings.length} warning(s))` : ""}`);
if (prep) console.log(`graph: ${prep.nodes} nodes, ${prep.edges} edges`);
console.log("\nnext, cheapest first:");
console.log("  npm run diagram:still     # one PNG, seconds, no TTS - check the layout");
console.log("  npm run diagram:smoke     # 3s of frames - check motion and audio wiring");
console.log("  npm run diagram:render    # the full narrated video");
process.exit(problems.length ? 1 : 0);
