// Flow + architecture diagram rendering for the walkthrough engine. Takes a
// scene's "flow" or "architecture" definition and renders it as a PNG slide
// (mermaid -> SVG -> PNG) that the narrated-video renderer uses as a scene
// background. The topology comes from real discovery data (graph nodes/edges);
// the LLM supplies grouping + narration.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProductSurface } from "./types.js";

export interface FlowScene {
  title: string;
  /** Ordered step labels of the core user flow. */
  steps: string[];
}

export interface ArchitectureScene {
  title: string;
  components: { name: string; role?: string }[];
}

/** Build a mermaid flowchart source from a flow scene. */
export function flowToMermaid(flow: FlowScene): string {
  const nodes = flow.steps.map((s, i) => `  N${i}["${s.replace(/"/g, '\\"')}"]`);
  const edges = flow.steps.slice(0, -1).map((_, i) => `  N${i} --> N${i + 1}`);
  return `flowchart TD\n${nodes.join("\n")}\n${edges.join("\n")}`;
}

/** Build a mermaid graph source from an architecture scene. */
export function architectureToMermaid(arch: ArchitectureScene): string {
  const nodes = arch.components.map((c, i) => `  C${i}["${c.name.replace(/"/g, '\\"')}${c.role ? `<br/>${c.role}` : ""}"]`);
  return `flowchart LR\n${nodes.join("\n")}`;
}

/** Render mermaid source to a PNG via a headless browser (mermaid in-page). */
export async function mermaidToPng(mermaidSource: string, outPath: string, opts: { width?: number; height?: number } = {}): Promise<string> {
  const width = opts.width ?? 1400;
  const height = opts.height ?? 785;
  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;background:#0b0d10;display:flex;align-items:center;justify-content:center;height:100vh}
.mermaid{background:#16181d;border:1px solid #262a31;border-radius:12px;padding:28px;max-width:94vw;max-height:92vh;overflow:auto}
.mermaid svg{color:#e8e8e8}</style>
<script type="module">
import mermaid from 'mermaid';
mermaid.initialize({ startOnLoad: false, theme: 'dark', themeVariables: { primaryColor: '#1e293b', primaryTextColor: '#e8e8e8', lineColor: '#60a5fa', edgeLabelBackground: '#16181d', actorBkg: '#1e293b', actorBorder: '#60a5fa' } });
const src = ${JSON.stringify(mermaidSource)};
const el = document.getElementById('m');
el.innerHTML = await mermaid.render('d', src);
</script></head>
<body><div class="mermaid" id="m"></div></body></html>`;
  const tmp = `${outPath}.html`;
  writeFileSync(tmp, html);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`file://${tmp}`, { waitUntil: "networkidle" }).catch(() => null);
    await page.waitForTimeout(1200); // let mermaid render
    await page.locator(".mermaid").screenshot({ path: outPath, omitBackground: false });
  } finally {
    await browser.close();
  }
  return outPath;
}

/** Build a flow scene from a discovered graph: collapse to the core journey. */
export function flowFromGraph(surface: ProductSurface): FlowScene | undefined {
  const g = surface.graph as { nodes?: Record<string, unknown>; entryPoints?: string[] } | undefined;
  if (!g?.nodes) return undefined;
  const entries = g.entryPoints ?? [];
  const nodeIds = Object.keys(g.nodes);
  const steps = entries.length ? entries : nodeIds.slice(0, 1);
  for (const id of nodeIds) {
    if (!steps.includes(id) && !id.includes("sign-in") && !id.includes("login")) steps.push(id);
  }
  return { title: "Core user flow", steps: steps.slice(0, 10) };
}

export interface PersonaCard {
  name: string;
  role?: string;
  problem: string;
  goal: string;
  product?: string;
}

/** Render a persona intro card to a PNG slide: who the demo is for, the
 *  problem they face, and the goal - the opening of a persona-driven demo. */
export async function personaToPng(p: PersonaCard, outPath: string): Promise<string> {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>
body{margin:0;background:#0b0d10;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e8e8e8}
.card{width:1180px;background:#16181d;border:1px solid #262a31;border-radius:16px;padding:56px 64px}
h1{font-size:38px;margin:0 0 6px;letter-spacing:-0.02em;color:#60a5fa}
.role{color:#9aa0a6;font-size:18px;margin-bottom:32px}
.row{display:flex;gap:28px;margin-top:28px}
.box{flex:1;background:#0f172a;border:1px solid #1e3a5f;border-radius:12px;padding:20px 24px}
.box h3{margin:0 0 8px;font-size:15px;color:#60a5fa}
.box p{margin:0;font-size:17px;line-height:1.5}
.tag{display:inline-block;font-size:12px;padding:3px 12px;border-radius:999px;background:#0f172a;color:#60a5fa;border:1px solid #1e3a5f;margin-bottom:14px}
</style></head>
<body>
<div class="card">
  <span class="tag">Persona</span>
  <h1>${p.name}</h1>
  <div class="role">${p.role ?? "user"}</div>
  <p style="font-size:18px;line-height:1.6">${p.product ? `${p.product} - ` : ""}who this walkthrough is for.</p>
  <div class="row">
    <div class="box"><h3>The problem</h3><p>${p.problem}</p></div>
    <div class="box"><h3>The goal</h3><p>${p.goal}</p></div>
  </div>
</div>
</body></html>`;
  const tmp = `${outPath}.html`;
  writeFileSync(tmp, html);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`file://${tmp}`, { waitUntil: "networkidle" }).catch(() => null);
    await page.waitForTimeout(400);
    await page.locator(".card").screenshot({ path: outPath, omitBackground: false });
  } finally {
    await browser.close();
  }
  return outPath;
}
