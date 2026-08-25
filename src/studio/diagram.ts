// Spec: v2 §5 (PM6, ENG1, ENG2) - see spec/traceability.md
// Animated architecture diagram scenes (spec v2 §5): the "professor". The
// diagram is a live SVG page recorded with Playwright + the DOM cursor overlay;
// element reveals, edge draws, and a scenario dot are keyframed on a JS
// timeline whose times come from the pre-synthesized narration clip durations.
// Choreography is emitted alongside the MP4 (spec §4: the render contract).
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { addCursorOverlay } from "../execution/os-cursor.js";
import { probeDuration } from "../execution/explain.js";
import { renderVideo } from "../execution/demo.js";
import { localChat, isLlmConfigured, llmModel } from "../llm/local.js";
import type { Respec, RespecComponent } from "../respec/respec.js";
import { synthCast } from "./tts.js";
import type { SceneChoreography, VoiceSpec } from "./types.js";

interface Box { id: string; name: string; kind: string; role: string; x: number; y: number; w: number; h: number }
interface Wire { from: string; to: string }

const KIND_ORDER = ["client", "frontend", "backend", "worker", "data", "provider", "other"];
const KIND_COLOR: Record<string, string> = { client: "#93c5fd", frontend: "#60a5fa", backend: "#34d399", worker: "#fbbf24", data: "#f472b6", provider: "#a78bfa", other: "#9ca3af" };

export function layoutTopology(topology: RespecComponent[], width = 1440, height = 860): { boxes: Box[]; wires: Wire[] } {
  const cols = new Map<string, RespecComponent[]>();
  for (const k of KIND_ORDER) cols.set(k, []);
  for (const c of topology) (cols.get(KIND_ORDER.includes(c.kind) ? c.kind : "other") ?? cols.get("other")!).push(c);
  const usedCols = [...cols.entries()].filter(([, v]) => v.length);
  const colW = Math.min(250, (width - 80) / Math.max(usedCols.length, 1));
  const boxes: Box[] = [];
  usedCols.forEach(([kind, comps], ci) => {
    const colX = 60 + ci * colW;
    const totalH = comps.length * 92;
    const startY = Math.max(110, (height - totalH) / 2);
    comps.forEach((c, ri) => {
      boxes.push({ id: safeId(c.name), name: c.name, kind, role: c.role, x: colX, y: startY + ri * 92, w: Math.min(215, colW - 25), h: 66 });
    });
  });
  const ids = new Set(boxes.map((b) => b.id));
  const wires: Wire[] = [];
  for (const c of topology) for (const d of c.dependsOn ?? []) {
    const from = safeId(c.name), to = safeId(d);
    if (ids.has(from) && ids.has(to)) wires.push({ from, to });
  }
  return { boxes, wires };
}

function safeId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function center(b: Box): { x: number; y: number } {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

export function buildDiagramHtml(title: string, boxes: Box[], wires: Wire[]): string {
  const boxSvg = boxes.map((b) => `
    <g id="el-${b.id}" class="el" opacity="0.13" transform="translate(0,10)">
      <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="10" fill="#16181d" stroke="${KIND_COLOR[b.kind]}" stroke-width="1.6"/>
      <text x="${b.x + 12}" y="${b.y + 26}" fill="#e8e8e8" font-size="15" font-weight="600">${esc(b.name)}</text>
      <text x="${b.x + 12}" y="${b.y + 46}" fill="#9aa0a6" font-size="11">${esc(b.role.slice(0, 34))}</text>
    </g>`).join("");
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const wireSvg = wires.map((w, i) => {
    const a = byId.get(w.from)!, b = byId.get(w.to)!;
    const p1 = center(a), p2 = center(b);
    return `<path id="wire-${i}" class="wire" d="M ${p1.x} ${p1.y} C ${(p1.x + p2.x) / 2} ${p1.y}, ${(p1.x + p2.x) / 2} ${p2.y}, ${p2.x} ${p2.y}" fill="none" stroke="#3b4250" stroke-width="1.4" opacity="0.35"/>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#0b0d10;font-family:-apple-system,BlinkMacSystemFont,sans-serif;overflow:hidden}
  .el{transition:opacity .5s ease, transform .5s ease}
  .el.on{opacity:1 !important;transform:translate(0,0) !important}
  .el.hot rect{stroke-width:3;filter:drop-shadow(0 0 8px rgba(96,165,250,.7))}
  .wire.hot{stroke:#60a5fa;opacity:1;stroke-width:2.4;stroke-dasharray:8 6;animation:flow 0.8s linear infinite}
  @keyframes flow{to{stroke-dashoffset:-14}}
  #dot{filter:drop-shadow(0 0 6px rgba(52,211,153,.9))}
  </style></head><body>
  <svg id="svg" width="1440" height="860" viewBox="0 0 1440 860">
    <text x="60" y="58" fill="#e8e8e8" font-size="26" font-weight="700">${esc(title)}</text>
    ${wireSvg}
    ${boxSvg}
    <circle id="dot" r="7" fill="#34d399" opacity="0"/>
  </svg>
  <script>
  const $ = (id) => document.getElementById(id);
  window.__reveal = (id) => { const e = $("el-"+id); if (e) e.classList.add("on"); };
  window.__hot = (id, on) => { const e = $("el-"+id); if (e) e.classList.toggle("hot", on); };
  window.__wire = (i, on) => { const e = $("wire-"+i); if (e) e.classList.toggle("hot", on); };
  // Camera: animate the viewBox for drill-down zooms (spec 13.2 L2).
  const svg = () => $("svg");
  let vb = [0,0,1440,860];
  window.__zoomTo = (x,y,w,h,ms) => new Promise((done)=>{
    const from = vb.slice(), to = [x,y,w,h]; const t0 = performance.now();
    const step = (t)=>{ const k = Math.min(1,(t-t0)/(ms||700)); const e = 1-Math.pow(1-k,3);
      vb = from.map((f,i)=>f+(to[i]-f)*e); svg().setAttribute("viewBox", vb.join(" "));
      if(k<1) requestAnimationFrame(step); else done(); };
    requestAnimationFrame(step);
  });
  window.__zoomOut = (ms) => window.__zoomTo(0,0,1440,860,ms);
  // L2 internals panel: rows revealed next to a component while zoomed in.
  window.__drill = (x, y, items) => {
    const NS = "http://www.w3.org/2000/svg";
    const g = document.createElementNS(NS, "g"); g.id = "drillPanel";
    const h = 26 + items.length*30;
    const r = document.createElementNS(NS, "rect");
    Object.entries({x:x, y:y, width:250, height:h, rx:10, fill:"#0f1420", stroke:"#6d8dff", "stroke-width":1.4, opacity:0.97}).forEach(([k,v])=>r.setAttribute(k,v));
    g.appendChild(r);
    items.forEach((it,i)=>{
      const t1 = document.createElementNS(NS,"text"); t1.setAttribute("x", x+14); t1.setAttribute("y", y+26+i*30); t1.setAttribute("fill","#e8e8e8"); t1.setAttribute("font-size","11.5"); t1.setAttribute("font-weight","600"); t1.textContent = it.name;
      const t2 = document.createElementNS(NS,"text"); t2.setAttribute("x", x+14); t2.setAttribute("y", y+38+i*30); t2.setAttribute("fill","#9aa0a6"); t2.setAttribute("font-size","9.5"); t2.textContent = (it.role||"").slice(0,42);
      g.appendChild(t1); g.appendChild(t2);
    });
    svg().appendChild(g);
  };
  window.__undrill = () => { const g = $("drillPanel"); if (g) g.remove(); };
  window.__travel = (fromXY, toXY, ms) => new Promise((done) => {
    const d = $("dot"); d.setAttribute("opacity", "1");
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      d.setAttribute("cx", fromXY.x + (toXY.x - fromXY.x) * k);
      d.setAttribute("cy", fromXY.y + (toXY.y - fromXY.y) * k);
      if (k < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
  window.__hideDot = () => $("dot").setAttribute("opacity", "0");
  </script></body></html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface DiagramNarration {
  intro: string;
  perComponent: Record<string, string>;
  scenarioIntro?: string;
  perHop?: string[];
}

/** Distinct Gemini voices for the humanized "cast" mode - each component
 *  speaks with its own voice; the narrator keeps the spec's cast voice. */
const CAST_VOICES = ["Puck", "Charon", "Aoede", "Fenrir", "Leda", "Zephyr", "Orus"];

/** First-person self-introductions for cast mode (spec 13.3): role,
 *  responsibilities, limitations - loose and conversational, respec-grounded. */
export async function draftCastNarration(respec: Respec, comps: RespecComponent[], audienceRegister?: string): Promise<Record<string, string>> {
  if (isLlmConfigured()) {
    const res = await localChat({
      text: [
        `Product: ${respec.oneLiner}`,
        `Write a FIRST-PERSON self-introduction (2-3 spoken sentences) for each component below, as if the component is a character introducing itself in a video: what I do, who I talk to, and one honest limitation. Conversational, distinct personalities, never rigid. Ground every claim in the given role/limitations only.`,
        ...comps.map((c) => `- ${c.name} (${c.kind}): ${c.role}${c.limitations?.length ? ` | limitations: ${c.limitations.join("; ")}` : ""}${c.dependsOn?.length ? ` | talks to: ${c.dependsOn.join(", ")}` : ""}`),
        audienceRegister ? `Register: ${audienceRegister}` : "",
      ].join("\n"),
      system: "You write character voice lines for a technical explainer. Honest, warm, grounded - no invented facts.",
      tool: {
        name: "emit_cast",
        description: "Self-introductions keyed by component name",
        inputSchema: { type: "object", properties: { lines: { type: "object", additionalProperties: { type: "string" } } }, required: ["lines"] },
      },
      maxTokens: 1800,
      model: llmModel(),
    });
    const t = res.toolInput as { lines?: Record<string, string> } | undefined;
    if (t?.lines && Object.keys(t.lines).length) return t.lines;
  }
  return Object.fromEntries(comps.map((c) => [c.name, `Hello - I am ${c.name}. ${c.role}.${c.limitations?.length ? ` One thing to know about me: ${c.limitations[0]}.` : ""}`]));
}

/** Draft professor narration from the respec (LLM optional, template fallback). */
export async function draftDiagramNarration(respec: Respec, tier: "summary" | "tutorial", scenario?: { name: string; steps: Array<{ from: string; to: string; action: string }> }, audienceRegister?: string): Promise<DiagramNarration> {
  const comps = tier === "summary" ? respec.topology.slice(0, 7) : respec.topology;
  if (isLlmConfigured()) {
    const res = await localChat({
      text: [
        `Write professor-style narration for an animated architecture diagram of: ${respec.oneLiner}`,
        audienceRegister ? `Register: ${audienceRegister}` : "",
        `Components (write one narration sentence each, in this order): ${comps.map((c) => `${c.name} (${c.kind}): ${c.role}`).join("; ")}`,
        scenario ? `Scenario "${scenario.name}" hops: ${scenario.steps.map((s) => `${s.from}->${s.to}: ${s.action}`).join("; ")}. Write one short sentence per hop plus a one-line intro to the trace.` : "",
        `Also write a one-sentence opening line for the whole diagram. ${tier === "summary" ? "Keep everything tight - this is a 60-90 second summary." : "This is a tutorial - a fuller sentence per component is fine."}`,
      ].filter(Boolean).join("\n"),
      system: "You write spoken narration for technical walkthrough videos. Every claim must come from the provided material.",
      tool: {
        name: "emit_narration",
        description: "Emit diagram narration",
        inputSchema: {
          type: "object",
          properties: {
            intro: { type: "string" },
            perComponent: { type: "object", additionalProperties: { type: "string" } },
            scenarioIntro: { type: "string" },
            perHop: { type: "array", items: { type: "string" } },
          },
          required: ["intro", "perComponent"],
        },
      },
      maxTokens: 1600,
      model: llmModel(),
    });
    const t = res.toolInput as DiagramNarration | undefined;
    if (t?.intro && t.perComponent) return t;
  }
  return {
    intro: `Here is how ${respec.oneLiner} fits together.`,
    perComponent: Object.fromEntries(comps.map((c) => [c.name, `${c.name}: ${c.role}.`])),
    scenarioIntro: scenario ? `Now watch ${scenario.name} travel through the system.` : undefined,
    perHop: scenario?.steps.map((s) => `From ${s.from} to ${s.to}: ${s.action}.`),
  };
}

export interface DiagramSceneResult {
  mp4: string;
  durationSec: number;
  choreography: SceneChoreography;
}

/** Render one animated, narrated diagram scene to MP4. */
export async function renderDiagramScene(opts: {
  sceneId: string;
  respec: Respec;
  tier: "summary" | "tutorial";
  scenarioName?: string;
  voice?: VoiceSpec;
  /** "cast" = each component speaks with its own voice (spec 13.3). */
  mode?: "narrator" | "cast";
  audienceRegister?: string;
  outMp4: string;
  staging: string;
}): Promise<DiagramSceneResult> {
  mkdirSync(opts.staging, { recursive: true });
  const comps = opts.tier === "summary" ? opts.respec.topology.slice(0, 7) : opts.respec.topology;
  const scenario = opts.scenarioName ? opts.respec.flows.find((f) => f.name === opts.scenarioName) ?? opts.respec.flows[0] : opts.respec.flows[0];
  const narration = await draftDiagramNarration(opts.respec, opts.tier, scenario, opts.audienceRegister);
  const cast = opts.mode === "cast" ? await draftCastNarration(opts.respec, comps, opts.audienceRegister) : undefined;

  // 1. Pre-synthesize every clip; durations drive the timeline. Cast mode
  //    gives each component a distinct voice; narrator keeps the spec voice.
  interface Clip { key: string; text: string; file: string; dur: number }
  const clips: Clip[] = [];
  const synth = async (key: string, text: string, voice?: VoiceSpec) => {
    const file = join(opts.staging, `dg-${clips.length}.wav`);
    await synthCast(text, voice ?? opts.voice, file);
    clips.push({ key, text, file, dur: await probeDuration(file) });
  };
  await synth("intro", narration.intro);
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i];
    const compVoice = cast ? { name: CAST_VOICES[i % CAST_VOICES.length], style: opts.voice?.style } : undefined;
    await synth(`comp:${c.name}`, (cast ? cast[c.name] : narration.perComponent[c.name]) ?? `${c.name}. ${c.role}.`, compVoice);
    // L2 drill-down (tutorial tier, when deep respec provided internals).
    if (opts.tier === "tutorial" && c.internals?.length) {
      const names = c.internals.slice(0, 5);
      await synth(`drill:${c.name}`, `Looking inside ${c.name}: ${names.map((x) => `${x.name} - ${x.role}`).join(". ")}.`, compVoice);
    }
  }
  const hops = scenario?.steps ?? [];
  if (scenario && narration.scenarioIntro) await synth("scenario", narration.scenarioIntro);
  for (let i = 0; i < hops.length; i++) await synth(`hop:${i}`, narration.perHop?.[i] ?? `${hops[i].from} to ${hops[i].to}: ${hops[i].action}.`);

  // 2. Schedule: sequential, 0.45s gaps.
  const GAP = 0.45;
  let t = 0.6;
  const schedule = clips.map((c) => {
    const at = t;
    t += c.dur + GAP;
    return { ...c, at };
  });
  // 2s tail: matches the browser path's own end buffer - enough for a TTS
  // provider's trailing silence/fade to finish audibly instead of clipping.
  const totalSec = t + 2;

  // 3. Layout + page.
  const { boxes, wires } = layoutTopology(comps);
  const byName = new Map(boxes.map((b) => [b.name, b]));
  const html = buildDiagramHtml(opts.respec.oneLiner.slice(0, 80), boxes, wires);
  const pagePath = join(opts.staging, `diagram-${opts.sceneId}.html`);
  writeFileSync(pagePath, html);

  // 4. Record: reveal/highlight/travel at clip starts; the cursor glides along.
  // recordStart marks when the webm recording actually begins (context
  // creation) - t0 (below) is captured after the page has loaded and
  // settled, so schedule times measured from t0 land `t0 - recordStart`
  // seconds LATER in the recorded file than their raw value suggests. Muxing
  // narration at the raw (unshifted) timestamp plays it early relative to the
  // visual event it describes, and trimming the output to the raw total
  // length cuts off that same lead-in time from the end.
  const recordStart = Date.now();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, recordVideo: { dir: opts.staging, size: { width: 1440, height: 860 } } });
  await addCursorOverlay(ctx);
  const page = await ctx.newPage();
  await page.goto("file://" + pagePath);
  await page.waitForTimeout(400);

  const choreography: SceneChoreography = {
    sceneId: opts.sceneId,
    durationSec: totalSec,
    tracks: { narration: [], cursor: [], animation: [], camera: [] },
  };
  const t0 = Date.now();
  const waitUntil = async (sec: number) => {
    const ms = t0 + sec * 1000 - Date.now();
    if (ms > 0) await page.waitForTimeout(ms);
  };

  let prevHot: string | undefined;
  let zoomed = false;
  const unzoom = async () => {
    if (!zoomed) return;
    zoomed = false;
    await page.evaluate(() => (window as never as { __undrill(): void }).__undrill()).catch(() => {});
    await page.evaluate(() => (window as never as { __zoomOut(ms?: number): Promise<void> }).__zoomOut(600)).catch(() => {});
  };
  for (const item of schedule) {
    await waitUntil(item.at);
    choreography.tracks.narration.push({ at: item.at, lineId: item.key, dur: item.dur, text: item.text });
    if (!item.key.startsWith("drill:")) await unzoom();
    if (item.key.startsWith("drill:")) {
      const c = comps.find((x) => `drill:${x.name}` === item.key);
      const b = c && byName.get(c.name);
      if (b && c?.internals?.length) {
        zoomed = true;
        const zx = Math.max(0, b.x - 80), zy = Math.max(0, b.y - 90);
        await page.evaluate(
          ([x, y, w, h]) => (window as never as { __zoomTo(x: number, y: number, w: number, h: number, ms?: number): Promise<void> }).__zoomTo(x as number, y as number, w as number, h as number, 700),
          [zx, zy, Math.min(720, b.w + 460), Math.min(500, b.h + 340)] as const
        ).catch(() => {});
        await page.evaluate(
          ([x, y, items]) => (window as never as { __drill(x: number, y: number, items: unknown): void }).__drill(x as number, y as number, items),
          [b.x + b.w + 18, b.y, c.internals.slice(0, 5)] as const
        ).catch(() => {});
        choreography.tracks.camera.push({ at: item.at, effect: "zoom", target: `el:${b.id}` });
        choreography.tracks.animation.push({ at: item.at, target: `el:${b.id}`, effect: "drill" });
      }
      continue;
    }
    if (item.key === "intro") {
      for (const b of boxes) { await page.evaluate((id) => (window as never as { __reveal(id: string): void }).__reveal(id), b.id); await page.waitForTimeout(90); }
      choreography.tracks.animation.push({ at: item.at, target: "all", effect: "reveal" });
    } else if (item.key.startsWith("comp:")) {
      const b = byName.get(item.key.slice(5));
      if (b) {
        if (prevHot) await page.evaluate(([id]) => (window as never as { __hot(id: string, on: boolean): void }).__hot(id, false), [prevHot]);
        await page.evaluate(([id]) => (window as never as { __hot(id: string, on: boolean): void }).__hot(id, true), [b.id]);
        prevHot = b.id;
        const c = center(b);
        await page.mouse.move(c.x + 30, c.y + 18, { steps: 18 });
        choreography.tracks.cursor.push({ at: item.at, to: `el:${b.id}`, x: c.x, y: c.y });
        choreography.tracks.animation.push({ at: item.at, target: `el:${b.id}`, effect: "highlight" });
      }
    } else if (item.key === "scenario") {
      if (prevHot) { await page.evaluate(([id]) => (window as never as { __hot(id: string, on: boolean): void }).__hot(id, false), [prevHot]); prevHot = undefined; }
      choreography.tracks.animation.push({ at: item.at, target: "scenario", effect: "begin" });
    } else if (item.key.startsWith("hop:")) {
      const i = Number(item.key.slice(4));
      const hop = hops[i];
      const a = byName.get(hop.from) ?? nearest(byName, hop.from);
      const b = byName.get(hop.to) ?? nearest(byName, hop.to);
      if (a && b) {
        const pa = center(a), pb = center(b);
        const travelMs = Math.min(item.dur * 1000 * 0.8, 2600);
        choreography.tracks.animation.push({ at: item.at, target: `${safe(hop.from)}->${safe(hop.to)}`, effect: "travel" });
        const mousePromise = page.mouse.move(pb.x + 30, pb.y + 18, { steps: 30 });
        await page.evaluate(
          ([f, to, ms]) => (window as never as { __travel(a: unknown, b: unknown, ms: number): Promise<void> }).__travel(f, to, ms as number),
          [pa, pb, travelMs] as const
        );
        await mousePromise;
        choreography.tracks.cursor.push({ at: item.at, to: `el:${b.id}`, x: pb.x, y: pb.y });
      }
    }
  }
  await unzoom();
  await waitUntil(totalSec);
  await page.evaluate(() => (window as never as { __hideDot(): void }).__hideDot()).catch(() => {});
  await ctx.close();
  await browser.close();

  // 5. Find the recorded webm and mux narration onto it.
  const webm = readdirSync(opts.staging).filter((f) => f.endsWith(".webm")).map((f) => join(opts.staging, f)).sort()[0];
  if (!webm) throw new Error("diagram scene: no recording produced");
  const leadSec = Math.max(0, (t0 - recordStart) / 1000);
  const narrated = schedule.map((s) => ({ file: s.file, atSec: s.at + leadSec, durSec: s.dur }));
  await renderVideo(webm, narrated, [], [], opts.outMp4, "1280:-2", true, false, totalSec + leadSec);
  rmSync(webm, { force: true });
  return { mp4: opts.outMp4, durationSec: totalSec, choreography };
}

// ---------------------------------------------------------------------------
// Animated SEQUENCE diagram (spec 13.2): lifelines, self-drawing message
// arrows, traveling payload dot, growing activation bars. Own SVG renderer -
// mermaid's generated SVG is animation-hostile.
// ---------------------------------------------------------------------------

export function buildSequenceHtml(title: string, participants: string[], hops: Array<{ from: string; to: string; action: string }>): string {
  const W = 1440, TOP = 120, ROW = 74;
  const colW = Math.min(240, (W - 120) / Math.max(participants.length, 2));
  const px = (i: number) => 90 + i * colW + colW / 2;
  const idx = new Map(participants.map((p, i) => [p, i]));
  const H = Math.max(860, TOP + hops.length * ROW + 120);
  const heads = participants.map((p, i) => `
    <g id="pt-${i}" class="pt" opacity="0.15">
      <rect x="${px(i) - 88}" y="${TOP - 62}" width="176" height="44" rx="9" fill="#16181d" stroke="#6d8dff" stroke-width="1.4"/>
      <text x="${px(i)}" y="${TOP - 34}" fill="#e8e8e8" font-size="13.5" font-weight="600" text-anchor="middle">${esc(p.slice(0, 24))}</text>
      <line x1="${px(i)}" y1="${TOP - 16}" x2="${px(i)}" y2="${H - 60}" stroke="#2b3346" stroke-width="1.2" stroke-dasharray="4 5"/>
    </g>`).join("");
  const msgs = hops.map((h, r) => {
    const a = idx.get(h.from) ?? nearestIdx(participants, h.from), b = idx.get(h.to) ?? nearestIdx(participants, h.to);
    const y = TOP + 26 + r * ROW;
    const x1 = px(a), x2 = px(b);
    const len = Math.abs(x2 - x1);
    return `
    <g id="msg-${r}" opacity="0">
      <line id="ml-${r}" x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#60a5fa" stroke-width="2" marker-end="url(#arr)" stroke-dasharray="${len}" stroke-dashoffset="${len}"/>
      <text x="${(x1 + x2) / 2}" y="${y - 9}" fill="#b9c2d4" font-size="11.5" text-anchor="middle">${esc(h.action.slice(0, 46))}</text>
      <rect id="act-${r}" x="${x2 - 5}" y="${y}" width="10" height="0" rx="3" fill="rgba(52,211,153,.7)"/>
    </g>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#0b0d10;font-family:-apple-system,BlinkMacSystemFont,sans-serif;overflow:hidden}
  .pt{transition:opacity .5s ease}.pt.on{opacity:1 !important}
  #dot{filter:drop-shadow(0 0 6px rgba(52,211,153,.9))}
  </style></head><body>
  <svg id="svg" width="1440" height="860" viewBox="0 0 ${W} ${Math.max(H, 860)}">
    <defs><marker id="arr" markerWidth="9" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0,0 L9,4 L0,8 z" fill="#60a5fa"/></marker></defs>
    <text x="60" y="52" fill="#e8e8e8" font-size="24" font-weight="700">${esc(title)}</text>
    ${heads}${msgs}
    <circle id="dot" r="7" fill="#34d399" opacity="0"/>
  </svg>
  <script>
  const $ = (id) => document.getElementById(id);
  window.__showPt = (i) => $("pt-"+i).classList.add("on");
  window.__msg = (r, x1, x2, y, ms) => new Promise((done) => {
    const g = $("msg-"+r), l = $("ml-"+r), act = $("act-"+r), d = $("dot");
    g.setAttribute("opacity", "1");
    const len = Math.abs(x2 - x1); const t0 = performance.now();
    d.setAttribute("opacity", "1");
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      l.setAttribute("stroke-dashoffset", String(len * (1 - k)));
      d.setAttribute("cx", String(x1 + (x2 - x1) * k)); d.setAttribute("cy", String(y));
      if (k < 1) requestAnimationFrame(step);
      else { let h = 0; const grow = () => { h = Math.min(34, h + 3); act.setAttribute("height", String(h)); if (h < 34) requestAnimationFrame(grow); }; grow(); done(); }
    };
    requestAnimationFrame(step);
  });
  window.__scrollTo = (y, ms) => new Promise((done) => {
    const s = $("svg"); const from = Number((s.getAttribute("viewBox")||"0 0 1440 860").split(" ")[1]);
    const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / (ms||600)); const e = 1 - Math.pow(1 - k, 3);
      s.setAttribute("viewBox", "0 " + (from + (y - from) * e) + " 1440 860");
      if (k < 1) requestAnimationFrame(step); else done(); };
    requestAnimationFrame(step);
  });
  </script></body></html>`;
}

function nearestIdx(participants: string[], name: string): number {
  const n = name.toLowerCase();
  const i = participants.findIndex((p) => p.toLowerCase().includes(n) || n.includes(p.toLowerCase()));
  return i >= 0 ? i : 0;
}

/** Render one animated, narrated sequence-diagram scene to MP4. */
export async function renderSequenceScene(opts: {
  sceneId: string;
  respec: Respec;
  scenarioName?: string;
  voice?: VoiceSpec;
  audienceRegister?: string;
  outMp4: string;
  staging: string;
}): Promise<DiagramSceneResult> {
  mkdirSync(opts.staging, { recursive: true });
  const flow = opts.scenarioName ? opts.respec.flows.find((f) => f.name === opts.scenarioName) ?? opts.respec.flows[0] : opts.respec.flows[0];
  if (!flow) throw new Error("sequence scene needs at least one respec flow");
  const participants = [...new Set(flow.steps.flatMap((s) => [s.from, s.to]))];
  const narration = await draftDiagramNarration(opts.respec, "summary", flow, opts.audienceRegister);

  interface Clip { key: string; text: string; file: string; dur: number }
  const clips: Clip[] = [];
  const synth = async (key: string, text: string) => {
    const file = join(opts.staging, `sq-${clips.length}.wav`);
    await synthCast(text, opts.voice, file);
    clips.push({ key, text, file, dur: await probeDuration(file) });
  };
  await synth("intro", narration.scenarioIntro ?? `Step by step: ${flow.name}.`);
  for (let i = 0; i < flow.steps.length; i++) await synth(`hop:${i}`, narration.perHop?.[i] ?? `${flow.steps[i].from} to ${flow.steps[i].to}: ${flow.steps[i].action}.`);

  const GAP = 0.4;
  let t = 0.6;
  const schedule = clips.map((c) => { const at = t; t += c.dur + GAP; return { ...c, at }; });
  // 2s tail: matches the browser path's own end buffer - enough for a TTS
  // provider's trailing silence/fade to finish audibly instead of clipping.
  const totalSec = t + 2;

  const html = buildSequenceHtml(flow.name, participants, flow.steps);
  const pagePath = join(opts.staging, `seq-${opts.sceneId}.html`);
  writeFileSync(pagePath, html);

  // recordStart marks when the webm recording actually begins (context
  // creation) - t0 (below) is captured after the page has loaded and
  // settled, so schedule times measured from t0 land `t0 - recordStart`
  // seconds LATER in the recorded file than their raw value suggests. See
  // renderDiagramScene above for the full explanation of this pattern.
  const recordStart = Date.now();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, recordVideo: { dir: opts.staging, size: { width: 1440, height: 860 } } });
  await addCursorOverlay(ctx);
  const page = await ctx.newPage();
  await page.goto("file://" + pagePath);
  await page.waitForTimeout(400);

  const TOP = 120, ROW = 74;
  const colW = Math.min(240, (1440 - 120) / Math.max(participants.length, 2));
  const px = (i: number) => 90 + i * colW + colW / 2;
  const idx = new Map(participants.map((p, i) => [p, i]));

  const choreography: SceneChoreography = { sceneId: opts.sceneId, durationSec: totalSec, tracks: { narration: [], cursor: [], animation: [], camera: [] } };
  const t0 = Date.now();
  const waitUntil = async (sec: number) => { const ms = t0 + sec * 1000 - Date.now(); if (ms > 0) await page.waitForTimeout(ms); };

  for (const item of schedule) {
    await waitUntil(item.at);
    choreography.tracks.narration.push({ at: item.at, lineId: item.key, dur: item.dur, text: item.text });
    if (item.key === "intro") {
      for (let i = 0; i < participants.length; i++) {
        await page.evaluate((n) => (window as never as { __showPt(n: number): void }).__showPt(n), i);
        await page.waitForTimeout(120);
      }
      choreography.tracks.animation.push({ at: item.at, target: "participants", effect: "reveal" });
      continue;
    }
    const r = Number(item.key.slice(4));
    const hop = flow.steps[r];
    const a = idx.get(hop.from) ?? 0, b = idx.get(hop.to) ?? 0;
    const y = TOP + 26 + r * ROW;
    if (y > 700) await page.evaluate((yy) => (window as never as { __scrollTo(y: number, ms?: number): Promise<void> }).__scrollTo(yy as number, 500), y - 500).catch(() => {});
    const msgMs = Math.min(item.dur * 1000 * 0.7, 2200);
    const mouse = page.mouse.move(px(b) + 24, Math.min(y, 760) + 14, { steps: 26 });
    await page.evaluate(
      ([rr, x1, x2, yy, ms]) => (window as never as { __msg(r: number, x1: number, x2: number, y: number, ms: number): Promise<void> }).__msg(rr as number, x1 as number, x2 as number, yy as number, ms as number),
      [r, px(a), px(b), y, msgMs] as const
    );
    await mouse;
    choreography.tracks.animation.push({ at: item.at, target: `msg:${r}`, effect: "draw+travel" });
    choreography.tracks.cursor.push({ at: item.at, to: `pt:${b}`, x: px(b), y });
  }
  await waitUntil(totalSec);
  await ctx.close();
  await browser.close();

  const webm = readdirSync(opts.staging).filter((f) => f.endsWith(".webm")).map((f) => join(opts.staging, f)).sort()[0];
  if (!webm) throw new Error("sequence scene: no recording produced");
  const leadSec = Math.max(0, (t0 - recordStart) / 1000);
  await renderVideo(webm, schedule.map((s) => ({ file: s.file, atSec: s.at + leadSec, durSec: s.dur })), [], [], opts.outMp4, "1280:-2", true, false, totalSec + leadSec);
  rmSync(webm, { force: true });
  return { mp4: opts.outMp4, durationSec: totalSec, choreography };
}

function safe(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** Loose match for scenario step names that aren't exact component names. */
function nearest(byName: Map<string, Box>, name: string): Box | undefined {
  const n = name.toLowerCase();
  for (const [k, v] of byName) if (k.toLowerCase().includes(n) || n.includes(k.toLowerCase())) return v;
  return undefined;
}
