// Interactive graph/path explorer UI (README roadmap): a single
// self-contained HTML file (no server, no CDN deps) with the graph, its
// analysis, and any prioritized paths/results embedded as JSON. Deliberately
// a static viewer, not a live app, to match this tool's "no server needed"
// philosophy (scan/discover already work with zero infra).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Graph, GraphAnalysis, PathRunResult, PrioritizedPath } from "../types.js";
import { renderProjectsHtml, type Artifact } from "./projects.js";

export interface ExplorerData {
  graph: Graph;
  analysis: GraphAnalysis;
  paths?: PrioritizedPath[];
  results?: PathRunResult[];
  appName: string;
  /** Collected run artifacts for the Projects tab. */
  project?: Artifact[];
}

function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function renderExplorerHtml(data: ExplorerData): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>prodlens explorer: ${data.appName}</title>
<style>
:root { --bg:#fff; --fg:#1a1a1a; --muted:#666; --border:#ddd; --panel:#f7f7f8; --accent:#2563eb; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#111214; --fg:#eee; --muted:#999; --border:#333; --panel:#1a1b1e; --accent:#60a5fa; }
}
* { box-sizing: border-box; }
body { margin:0; font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; background:var(--bg); color:var(--fg); }
header { padding: 12px 16px; border-bottom: 1px solid var(--border); display:flex; align-items:center; gap:16px; }
header h1 { font-size: 15px; margin: 0; }
nav button { background:none; border:1px solid var(--border); color:var(--fg); padding:5px 10px; border-radius:6px; cursor:pointer; font-size:13px; }
nav button.active { background:var(--accent); color:#fff; border-color:var(--accent); }
.layout { display:flex; height: calc(100vh - 49px); }
.sidebar { width: 300px; border-right:1px solid var(--border); overflow-y:auto; }
.sidebar input { width: calc(100% - 20px); margin:8px 10px; padding:6px 8px; border:1px solid var(--border); border-radius:6px; background:var(--panel); color:var(--fg); }
.node-item { padding:7px 12px; cursor:pointer; font-size:13px; display:flex; align-items:center; gap:6px; border-bottom:1px solid var(--border); }
.node-item:hover, .node-item.selected { background: var(--panel); }
.dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
.dot.ok { background:#22c55e; } .dot.warn { background:#f59e0b; } .dot.bad { background:#ef4444; } .dot.untested { background:#9ca3af; }
main { flex:1; overflow-y:auto; padding: 20px 24px; }
table { width:100%; border-collapse: collapse; font-size:13px; margin-bottom:20px; }
th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--border); vertical-align:top; }
th { color:var(--muted); font-weight:600; }
.badge { padding:1px 7px; border-radius:10px; font-size:11px; font-weight:600; color:#fff; display:inline-block; }
.badge.working, .badge.passed { background:#22c55e; } .badge.broken, .badge.failed { background:#ef4444; }
.badge.untested, .badge.planned { background:#9ca3af; } .badge.unreachable, .badge.partial { background:#f59e0b; }
.badge.missing { background:#a855f7; } .badge.approved, .badge.running { background:var(--accent); } .badge.skipped { background:#6b7280; }
.muted { color:var(--muted); }
.step { padding:6px 0; border-bottom:1px solid var(--border); font-size:13px; }
.step:last-child { border-bottom:none; }
h2 { font-size:14px; margin: 22px 0 8px; }
h2:first-child { margin-top:0; }
code { background:var(--panel); padding:1px 5px; border-radius:4px; font-size:12px; }
details { border:1px solid var(--border); border-radius:6px; padding:8px 10px; margin:6px 0; font-size:13px; }
details summary { cursor:pointer; color:var(--accent); }
.health { font-size:14px; margin: 10px 0 16px; }
.health .big { font-size:22px; font-weight:700; }
.healthline { margin:6px 0; }
.sumbullet { margin:4px 0; }
.verdict-ok { color:#22c55e; } .verdict-warn { color:#f59e0b; } .verdict-bad { color:#ef4444; }
.finding { margin:8px 0; }
.finding h3 { font-size:13px; margin:14px 0 4px; }
.section { display:none; }
.section.active { display:block; }
.projects-layout { display:flex; gap:24px; align-items:flex-start; }
.projects-list { flex:0 0 320px; }
.projects-detail { flex:1; min-width:0; }
.projects-detail pre { max-height:60vh; overflow:auto; background:var(--panel); padding:10px; border-radius:6px; font-size:12px; }
.projects-detail .markdown { line-height:1.5; }
.markdown h1, .markdown h2, .markdown h3, .markdown h4 { border-bottom:1px solid var(--border); padding-bottom:4px; }
.markdown li { list-style:disc; margin-left:18px; }
.markdown .codeblock { background:var(--panel); padding:8px; border-radius:6px; overflow-x:auto; }
.artifact-open { background:none; border:1px solid var(--border); color:var(--accent); border-radius:6px; padding:3px 10px; cursor:pointer; font-size:12px; }
.artifact-open:hover { background:var(--accent); color:#fff; border-color:var(--accent); }
.video { max-width:100%; border:1px solid var(--border); border-radius:6px; }
</style>
</head>
<body>
<header>
  <h1>prodlens explorer — ${data.appName}</h1>
  <nav>
    <button data-view="summary" class="active">Summary</button>
    <button data-view="graph">Graph</button>
    <button data-view="paths">Paths (${data.paths?.length ?? 0})</button>
    <button data-view="issues">Issues</button>
    ${data.project?.length ? '<button data-view="projects">Projects (' + data.project.length + ")</button>" : ""}
  </nav>
</header>
<div class="layout">
  <div class="sidebar" id="sidebar"></div>
  <main id="main"></main>
</div>
<script>
const GRAPH = ${embedJson(data.graph)};
const ANALYSIS = ${embedJson(data.analysis)};
const PATHS = ${embedJson(data.paths ?? [])};
const RESULTS = ${embedJson(data.results ?? [])};
const PROJECT = ${embedJson(data.project ?? [])};
const PROJECTS_HTML = ${JSON.stringify(data.project?.length ? renderProjectsHtml(data.project) : "")};

const nodeIds = Object.keys(GRAPH.nodes).sort();
const unreachable = new Set(ANALYSIS.unreachableNodes);
const deadEnd = new Set(ANALYSIS.deadEndNodes);
let view = "graph";
let selectedNode = nodeIds.find((id) => GRAPH.entryPoints.includes(id)) || nodeIds[0];

function nodeStatusClass(id) {
  if (unreachable.has(id)) return "bad";
  if (deadEnd.has(id)) return "warn";
  return "ok";
}

function edgesFrom(id) { return GRAPH.edges.filter((e) => e.from === id); }
function edgesTo(id) { return GRAPH.edges.filter((e) => e.to === id); }

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderSidebar() {
  const sidebar = document.getElementById("sidebar");
  sidebar.innerHTML = '<input type="text" id="filter" placeholder="Filter screens...">' +
    '<div id="node-list"></div>';
  document.getElementById("filter").addEventListener("input", (e) => renderNodeList(e.target.value));
  renderNodeList("");
}

function renderNodeList(filter) {
  const list = document.getElementById("node-list");
  const filtered = nodeIds.filter((id) => id.toLowerCase().includes(filter.toLowerCase()));
  list.innerHTML = filtered.map((id) =>
    '<div class="node-item' + (id === selectedNode ? ' selected' : '') + '" data-node="' + escapeHtml(id) + '">' +
    '<span class="dot ' + nodeStatusClass(id) + '"></span><span>' + escapeHtml(id) + '</span></div>'
  ).join("");
  list.querySelectorAll(".node-item").forEach((el) => el.addEventListener("click", () => {
    selectedNode = el.dataset.node;
    renderNodeList(filter);
    renderMain();
  }));
}

function edgeRow(e, showTo) {
  const target = showTo ? e.to : e.from;
  return '<tr><td>' + escapeHtml(e.action) + '</td><td>' + (target ? '<code>' + escapeHtml(target) + '</code>' : '<span class="muted">unresolved</span>') +
    '</td><td><span class="badge ' + e.status + '">' + e.status + '</span></td><td class="muted">' + escapeHtml(e.error || "") + '</td></tr>';
}

function renderGraphView() {
  const node = GRAPH.nodes[selectedNode];
  if (!node) return '<p class="muted">No screen selected.</p>';
  const out = edgesFrom(selectedNode), incoming = edgesTo(selectedNode);
  let html = '<h2>' + escapeHtml(selectedNode) + '</h2>';
  html += '<p class="muted">' + escapeHtml(node.title || "") + ' &middot; source: ' + escapeHtml(node.source) +
    (node.sourceFile ? ' &middot; <code>' + escapeHtml(node.sourceFile) + '</code>' : '') + '</p>';
  if (node.metadata && node.metadata.forms && node.metadata.forms.length) {
    html += '<p class="muted">Forms detected: ' + node.metadata.forms.map((f) => f.fields.length + ' field(s)').join(", ") + '</p>';
  }
  html += '<h2>Outgoing (' + out.length + ')</h2>';
  html += out.length
    ? '<table><tr><th>Action</th><th>To</th><th>Status</th><th>Error</th></tr>' + out.map((e) => edgeRow(e, true)).join("") + '</table>'
    : '<p class="muted">None.</p>';
  html += '<h2>Incoming (' + incoming.length + ')</h2>';
  html += incoming.length
    ? '<table><tr><th>Action</th><th>From</th><th>Status</th><th>Error</th></tr>' + incoming.map((e) => edgeRow(e, false)).join("") + '</table>'
    : '<p class="muted">None - nothing links here.</p>';
  return html;
}

function resultFor(pathId) { return RESULTS.find((r) => r.pathId === pathId); }

function renderPathsView() {
  if (!PATHS.length) return '<p class="muted">No prioritized paths loaded - pass --paths when running explore.</p>';
  return PATHS.map((p) => {
    const result = resultFor(p.id);
    const stepsHtml = p.steps.map((s, i) =>
      '<div class="step">' + (i + 1) + '. ' + escapeHtml(s.action) +
      (s.status ? ' <span class="badge ' + s.status + '">' + s.status + '</span>' : '') +
      (s.error ? ' <span class="muted">' + escapeHtml(s.error) + '</span>' : '') + '</div>'
    ).join("");
    return '<h2>' + escapeHtml(p.goal) + ' <span class="badge ' + (result ? result.status : p.status) + '">' +
      (result ? result.status : p.status) + '</span> <span class="badge ' + p.priority + '" style="background:#374151">' + p.priority + '</span></h2>' +
      '<p class="muted">' + escapeHtml(p.reason) + '</p>' + stepsHtml;
  }).join("");
}

function listSection(title, items, render) {
  if (!items.length) return '<h2>' + title + ' (0)</h2><p class="muted">None.</p>';
  return '<h2>' + title + ' (' + items.length + ')</h2><table>' + items.map(render).join("") + '</table>';
}

function renderProjectsView() {
  if (!PROJECT.length) return '<p class="muted">No project artifacts passed with --project.</p>';
  return PROJECTS_HTML;
}

function renderIssuesView() {
  let html = "";
  html += listSection("Unreachable screens", ANALYSIS.unreachableNodes, (id) => '<tr><td><code>' + escapeHtml(id) + '</code></td></tr>');
  html += listSection("Dead-end screens", ANALYSIS.deadEndNodes, (id) => '<tr><td><code>' + escapeHtml(id) + '</code></td></tr>');
  html += listSection("Missing return paths", ANALYSIS.missingReturnPaths, (m) =>
    '<tr><td><code>' + escapeHtml(m.from) + '</code> &rarr; <code>' + escapeHtml(m.to) + '</code></td></tr>');
  html += listSection("Broken edges", ANALYSIS.brokenEdges, (e) =>
    '<tr><td>' + escapeHtml(e.action) + '</td><td class="muted">' + escapeHtml(e.error || "") + '</td></tr>');
  html += listSection("Dead static elements", ANALYSIS.deadStaticElements, (e) =>
    '<tr><td>' + escapeHtml(e.action) + '</td><td class="muted"><code>' + escapeHtml(e.sourceFile || "") + ':' + (e.sourceLine ?? "") + '</code></td></tr>');
  return html;
}

function renderMain() {
  const main = document.getElementById("main");
  if (view === "summary") main.innerHTML = renderSummaryView();
  else if (view === "graph") main.innerHTML = renderGraphView();
  else if (view === "paths") main.innerHTML = renderPathsView();
  else if (view === "projects") main.innerHTML = renderProjectsView();
  else main.innerHTML = renderIssuesView();
}

function summaryFinding(title, count, plain, detail) {
  if (!count) return "";
  return '<div class="finding"><h3>' + title + ' (' + count + ')</h3><div class="muted">' + plain + '</div>' +
    (detail ? '<details><summary>Technical detail</summary>' + detail + '</details>' : '') + '</div>';
}

function renderSummaryView() {
  const nNodes = nodeIds.length;
  const findings = [];
  findings.push(summaryFinding("Dead buttons & links", ANALYSIS.deadStaticElements.length,
    "These look like buttons but do nothing when people click them. They have no click handler, no link, and no form action.",
    ANALYSIS.deadStaticElements.map((e) => '<p>' + escapeHtml(e.action) + ' - <code>' + escapeHtml(e.sourceFile || "") + ':' + escapeHtml(String(e.sourceLine ?? "")) + '</code></p>').join("")));
  findings.push(summaryFinding("Transitions that fail", ANALYSIS.brokenEdges.length,
    "A click that should take someone to another screen but doesn't. Either the page stays put or the action errors out.",
    ANALYSIS.brokenEdges.map((e) => '<p>click "' + escapeHtml(e.action) + '" on ' + escapeHtml(e.from) + ' -> ' + escapeHtml(e.to || "unresolved") +
      (e.error ? '<br><code>' + escapeHtml(e.error) + '</code>' : '') + '</p>').join("")));
  findings.push(summaryFinding("Screens nothing links to", ANALYSIS.unreachableNodes.length,
    "These screens exist in the app, but no button or link anywhere in the app connects to them. Users could only reach them by typing the URL.",
    ANALYSIS.unreachableNodes.map((id) => '<p><code>' + escapeHtml(id) + '</code></p>').join("")));
  findings.push(summaryFinding("Dead-end screens", ANALYSIS.deadEndNodes.length,
    "You can get here, but there is no button or link that takes you anywhere else. A trap for users.",
    ANALYSIS.deadEndNodes.map((id) => '<p><code>' + escapeHtml(id) + '</code></p>').join("")));
  findings.push(summaryFinding("Missing return paths", ANALYSIS.missingReturnPaths.length,
    "Ways to get here, but no way back out again - a user reaches them and their only option is the back button.",
    ANALYSIS.missingReturnPaths.map((m) => '<p><code>' + escapeHtml(m.from) + '</code> to <code>' + escapeHtml(m.to) + '</code></p>').join("")));
  findings.push(summaryFinding("Local-state-only buttons", ANALYSIS.localStateOnlyElements.length,
    "These only change the page you're on (opening dialogs, filtering lists) and never save anything. Some are intentional; some may be missing their 'save' step.",
    ANALYSIS.localStateOnlyElements.map((e) => '<p>' + escapeHtml(e.action) + ' - <code>' + escapeHtml(e.sourceFile || "") + ':' + (e.sourceLine ?? "") + '</code></p>').join("")));

  var problemCount = ANALYSIS.deadStaticElements.length + ANALYSIS.brokenEdges.length + ANALYSIS.unreachableNodes.length;
  var healthCls = problemCount === 0 ? "verdict-ok" : "verdict-warn";
  var healthWord = problemCount === 0 ? "Looking good, no problems found." : "Has issues worth a look (" + problemCount + " finding(s)).";

  var html = '<h2>Overall</h2>';
  html += '<div class="health"><div class="big ' + healthCls + '">' + nNodes + ' screens</div>';
  html += '<div class="healthline ' + healthCls + '">' + healthWord + '</div>';
  if (PATHS.length) {
    var passed = RESULTS.filter(function(r){ return r.status === "passed"; }).length;
    html += '<div class="healthline">Prioritized journeys executed: ' + passed + '/' + RESULTS.length + ' passed. <a href="#" onclick="switchView(&apos;paths&apos;); return false;">See journeys</a></div>';
  }
  html += '</div>';
  html += '<h2>What we found</h2>' + findings.join("") +
    '<details><summary>Raw analysis (advanced)</summary><div class="muted">This is the raw data the report is built from.</div><pre>' + escapeHtml(JSON.stringify(ANALYSIS, null, 2)) + '</pre></details>';
  return html;
}

function switchView(name) {
  view = name;
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  renderMain();
}

document.querySelectorAll("nav button").forEach((btn) => btn.addEventListener("click", () => switchView(btn.dataset.view)));

// Projects tab: "open" buttons reveal their pre-rendered detail block.
document.addEventListener("click", (ev) => {
  const target = ev.target.closest(".artifact-open");
  if (!target) return;
  const id = target.dataset.id;
  const all = document.querySelectorAll(".artifact-detail");
  all.forEach((d) => { d.hidden = true; });
  const detail = document.querySelector('.artifact-detail[id="' + CSS.escape(id) + '"]');
  if (detail) detail.hidden = false;
});

renderSidebar();
renderMain();
</script>
</body>
</html>
`;
}

export function writeExplorer(html: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
}
