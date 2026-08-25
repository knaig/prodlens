// Spec: v2 §7 P1-P7 - see spec/traceability.md
// Prodlens web app UI. Zero-dependency single page, designed as a product:
// left rail navigation, per-project overview dashboard, visual pipeline
// stepper, storyboard cards, inline video players, and a real console drawer.
export const APP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ProdLens</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#0a0c10;--bg2:#0e1117;--panel:#141925;--panel2:#1a2130;--border:#232b3b;--border2:#2e3950;
  --fg:#e9edf4;--muted:#8b95a8;--dim:#5b6474;
  --accent:#6d8dff;--accent2:#22d3ee;--green:#34d399;--red:#fb7185;--amber:#fbbf24;--violet:#a78bfa;
  --grad:linear-gradient(135deg,#6d8dff 0%,#22d3ee 100%);
  --shadow:0 8px 28px rgba(0,0,0,.38);--r:14px;
}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--fg);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;line-height:1.5}
::selection{background:rgba(109,141,255,.35)}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.layout{display:flex;min-height:100vh}

/* ---------- left rail ---------- */
.side{width:248px;flex-shrink:0;background:var(--bg2);border-right:1px solid var(--border);padding:20px 14px;display:flex;flex-direction:column;position:sticky;top:0;height:100vh;overflow-y:auto}
.brand{display:flex;align-items:center;gap:10px;padding:2px 8px 18px}
.brand .mark{width:30px;height:30px;border-radius:9px;background:var(--grad);display:flex;align-items:center;justify-content:center;font-weight:800;color:#071018;font-size:15px;box-shadow:0 4px 14px rgba(60,120,255,.35)}
.brand .name{font-weight:700;font-size:16px;letter-spacing:.2px}
.brand .tag{font-size:10px;color:var(--dim);display:block;margin-top:-2px}
.sideLabel{font-size:10.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);padding:14px 10px 6px}
.proj{display:flex;flex-direction:column;padding:9px 10px;border-radius:10px;cursor:pointer;margin-bottom:3px;border:1px solid transparent;transition:background .12s}
.proj:hover{background:var(--panel)}
.proj.sel{background:var(--panel);border-color:var(--border2)}
.proj .pn{font-weight:600;font-size:13.5px}
.proj .pu{color:var(--dim);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.navItem{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;cursor:pointer;color:var(--muted);font-weight:500;font-size:13.5px;margin-bottom:2px}
.navItem:hover{background:var(--panel);color:var(--fg)}
.navItem.sel{background:var(--panel);color:var(--fg);border:1px solid var(--border2)}
.navItem .ic{width:17px;text-align:center;opacity:.9}
.sideFoot{margin-top:auto;padding:12px 10px;color:var(--dim);font-size:11px}

/* ---------- main ---------- */
.main{flex:1;min-width:0;padding:26px 34px 120px;max-width:1160px}
.crumbs{color:var(--dim);font-size:12px;margin-bottom:6px}
.pageHead{display:flex;align-items:center;gap:14px;margin-bottom:20px;flex-wrap:wrap}
.pageHead h1{font-size:22px;font-weight:700;margin:0}
.urlChip{background:var(--panel);border:1px solid var(--border);border-radius:999px;padding:4px 12px;font-size:12px;color:var(--muted);font-family:"JetBrains Mono",monospace}
h2{font-size:15px;font-weight:600;margin:0 0 12px}
h3{font-size:11.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);margin:22px 0 10px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:var(--r);padding:18px 20px;margin-bottom:14px}
.grid{display:grid;gap:12px}
.grid.c4{grid-template-columns:repeat(auto-fit,minmax(170px,1fr))}
.grid.c3{grid-template-columns:repeat(auto-fit,minmax(230px,1fr))}
.grid.c2{grid-template-columns:repeat(auto-fit,minmax(340px,1fr))}
.stat{background:var(--panel);border:1px solid var(--border);border-radius:var(--r);padding:16px 18px}
.stat .v{font-size:26px;font-weight:800;letter-spacing:-.5px}
.stat .l{color:var(--muted);font-size:12px;margin-top:2px}
.stat .s{font-size:11px;margin-top:6px}

/* ---------- buttons, badges, forms ---------- */
.btn{background:var(--grad);color:#08131f;font-weight:600;padding:9px 18px;border:0;border-radius:10px;font-size:13.5px;cursor:pointer;transition:transform .08s, box-shadow .12s;box-shadow:0 3px 12px rgba(60,120,255,.25)}
.btn:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(60,120,255,.35)}
.btn:active{transform:translateY(0)}
.btn.sm{padding:6px 12px;font-size:12.5px;border-radius:8px}
.btn.ghost{background:var(--panel2);color:var(--fg);border:1px solid var(--border2);box-shadow:none}
.btn.ghost:hover{border-color:var(--accent)}
.btn.danger{background:transparent;color:var(--red);border:1px solid var(--border);box-shadow:none}
.btn.ok{background:transparent;color:var(--green);border:1px solid var(--border);box-shadow:none}
.btn:disabled{opacity:.35;cursor:not-allowed;transform:none;box-shadow:none}
.badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:2px 10px;border-radius:999px;border:1px solid var(--border2);color:var(--muted)}
.badge.green,.badge.approved,.badge.passed,.badge.done,.badge.confirmed{color:var(--green);border-color:rgba(52,211,153,.35);background:rgba(52,211,153,.07)}
.badge.red,.badge.skipped,.badge.failed,.badge.error,.badge.critical{color:var(--red);border-color:rgba(251,113,133,.35);background:rgba(251,113,133,.07)}
.badge.amber,.badge.planned,.badge.running,.badge.queued,.badge.medium,.badge.high,.badge.interrupted{color:var(--amber);border-color:rgba(251,191,36,.35);background:rgba(251,191,36,.07)}
label{display:block;font-size:11.5px;font-weight:500;color:var(--muted);margin:12px 0 5px}
input,select,textarea{width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:9px;color:var(--fg);padding:9px 12px;font-size:13px;font-family:inherit;transition:border-color .12s}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--accent)}
textarea{resize:vertical;line-height:1.55}
table{width:100%;border-collapse:collapse;font-size:13px}
td,th{padding:9px 10px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}
th{color:var(--dim);font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;font-weight:600}
tr:last-child td{border-bottom:none}
.muted{color:var(--muted)}.dim{color:var(--dim)}
.mono{font-family:"JetBrains Mono",monospace;font-size:12px}
.row2{display:flex;gap:14px;flex-wrap:wrap}.row2>div{flex:1;min-width:220px}
.empty{border:1.5px dashed var(--border2);border-radius:var(--r);padding:34px;text-align:center;color:var(--muted)}
.empty .big{font-size:30px;margin-bottom:8px}
.empty b{color:var(--fg)}

/* ---------- pipeline stepper ---------- */
.stepper{display:flex;align-items:stretch;gap:0;overflow-x:auto;padding:6px 0 2px}
.step{position:relative;flex:1;min-width:150px;background:var(--panel);border:1px solid var(--border);padding:14px 16px;cursor:default}
.step:first-child{border-radius:var(--r) 0 0 var(--r)}
.step:last-child{border-radius:0 var(--r) var(--r) 0}
.step+.step{border-left:none}
.step .num{width:22px;height:22px;border-radius:50%;background:var(--panel2);border:1px solid var(--border2);color:var(--muted);font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;margin-bottom:8px}
.step.done .num{background:rgba(52,211,153,.15);border-color:var(--green);color:var(--green)}
.step.err .num{background:rgba(251,113,133,.15);border-color:var(--red);color:var(--red)}
.step.live .num{background:rgba(251,191,36,.15);border-color:var(--amber);color:var(--amber)}
.step .sn{font-weight:600;font-size:13.5px}
.step .sd{color:var(--dim);font-size:11px;margin:3px 0 10px;min-height:28px}
.step .sm2{font-size:11px;color:var(--muted);margin-top:8px;line-height:1.5}
.step.off{opacity:.45}
.spin{display:inline-block;width:12px;height:12px;border:2px solid var(--amber);border-top-color:transparent;border-radius:50%;animation:sp .7s linear infinite;vertical-align:-2px}
@keyframes sp{to{transform:rotate(360deg)}}

/* ---------- console drawer ---------- */
#console{position:fixed;left:248px;right:0;bottom:0;background:#0a0d12ee;border-top:1px solid var(--border2);backdrop-filter:blur(8px);transform:translateY(calc(100% - 38px));transition:transform .22s ease;z-index:40}
#console.open{transform:translateY(0)}
#console .bar{display:flex;align-items:center;gap:12px;padding:8px 20px;cursor:pointer;font-size:12.5px}
#console .bar .dot{width:8px;height:8px;border-radius:50%;background:var(--dim)}
#console.running .bar .dot{background:var(--amber);animation:pulse 1.1s infinite}
@keyframes pulse{50%{opacity:.3}}
#consoleLog{height:220px;overflow:auto;padding:4px 20px 16px;font-family:"JetBrains Mono",monospace;font-size:11.5px;white-space:pre-wrap;color:#b9c2d4;line-height:1.65}

/* ---------- storyboard ---------- */
.actHead{display:flex;align-items:center;gap:10px;margin:20px 0 10px;color:var(--violet);font-weight:600;font-size:12px;letter-spacing:.06em;text-transform:uppercase}
.actHead:before{content:"";width:18px;height:1px;background:var(--violet)}
.sceneRow{display:flex;gap:12px;overflow-x:auto;padding-bottom:6px}
.scene{background:var(--panel);border:1px solid var(--border);border-radius:var(--r);padding:14px;min-width:270px;max-width:270px;flex-shrink:0}
.scene .st{display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px}
.scene .ic{width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:13px;background:var(--panel2);border:1px solid var(--border2)}
.scene .target{color:var(--dim);font-size:11px;font-family:"JetBrains Mono",monospace;margin:4px 0 8px}
.scene textarea{min-height:76px;font-size:12px}
.gap{border-left:3px solid var(--amber);background:rgba(251,191,36,.05);border-radius:0 10px 10px 0;padding:10px 14px;margin-bottom:8px;font-size:12.5px}
.gap b{color:var(--amber)}
video{width:100%;max-width:720px;border-radius:12px;border:1px solid var(--border2);background:#000;box-shadow:var(--shadow)}
.toastWrap{position:fixed;bottom:52px;right:18px;z-index:60;display:flex;flex-direction:column;gap:8px}
.toast{background:var(--panel2);border:1px solid var(--border2);border-radius:10px;padding:10px 16px;font-size:12.5px;box-shadow:var(--shadow);animation:in .18s ease}
@keyframes in{from{transform:translateY(8px);opacity:0}}
.issue{display:flex;gap:14px;background:var(--panel);border:1px solid var(--border);border-left-width:3px;border-radius:10px;padding:13px 16px;margin-bottom:8px;align-items:flex-start}
.issue.critical,.issue.high{border-left-color:var(--red)}
.issue.medium{border-left-color:var(--amber)}
.issue.low{border-left-color:var(--dim)}
.capbar{background:var(--panel2);border-radius:6px;height:7px;width:140px;overflow:hidden}
.capbar>div{height:7px;border-radius:6px}
.tierCard{background:var(--panel);border:1px solid var(--border);border-radius:var(--r);padding:18px;display:flex;flex-direction:column}
.tierCard.hot{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent), var(--shadow)}
.tierCard .price{font-size:24px;font-weight:800;margin:4px 0}
.tierCard ul{margin:10px 0 0;padding-left:16px;color:var(--muted);font-size:12px;line-height:1.9}
</style>
</head>
<body>
<div class="layout">
  <div class="side">
    <div class="brand"><div class="mark">P</div><div><span class="name">ProdLens</span><span class="tag">see your whole product</span></div></div>
    <div class="sideLabel">Projects</div>
    <div id="projects"></div>
    <button class="btn ghost sm" style="margin:8px 8px 0" onclick="showNew()">+ New project</button>
    <div class="sideLabel">Workspace</div>
    <div id="nav"></div>
    <div class="sideLabel">Account</div>
    <div class="navItem" id="navAdmin" onclick="showAdmin()"><span class="ic">◔</span> Costs &amp; pricing</div>
    <div class="sideFoot">local control plane · <a href="/legacy">legacy form</a></div>
  </div>
  <div class="main" id="main"></div>
</div>
<div id="console"><div class="bar" onclick="toggleConsole()"><span class="dot"></span><b id="consoleTitle">Console</b><span class="muted" id="consoleStatus">idle</span><span style="margin-left:auto" class="dim">click to expand ▴</span></div><div id="consoleLog"></div></div>
<div class="toastWrap" id="toasts"></div>
<script>
let state = { projects: [], sel: null, tab: "overview", paths: [], report: null, triage: {}, jobs: [], artifacts: [], es: null, studio: null, admin: false };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function toast(msg, ms=3800){ const t=document.createElement("div"); t.className="toast"; t.textContent=msg; $("toasts").appendChild(t); setTimeout(()=>t.remove(), ms); }
async function api(path, opts){ const r = await fetch(path, opts); const j = await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error || ("HTTP "+r.status)); return j; }
const post = (path, body) => api(path, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body||{}) });
const put  = (path, body) => api(path, { method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body||{}) });

const NAV = [
  ["overview","▦","Overview"],["verify","✓","Verify"],["journeys","➜","Journeys"],["issues","⚑","Issues"],
  ["understand","◎","Understand"],["studio","▶","Studio"],["artifacts","▤","Artifacts"],["history","⟳","History"],["settings","⚙","Settings"],
];

async function loadProjects(){
  state.projects = await api("/api/projects");
  renderSide();
  if (state.sel && !state.projects.find(p=>p.id===state.sel)) state.sel = null;
  if (!state.sel && state.projects.length) select(state.projects[0].id); else render();
}
function renderSide(){
  $("projects").innerHTML = state.projects.map(p =>
    '<div class="proj '+(p.id===state.sel&&!state.admin?"sel":"")+'" onclick="select(\\''+p.id+'\\')"><span class="pn">'+esc(p.name)+'</span><span class="pu">'+esc(p.baseUrl.replace(/^https?:\\/\\//,""))+'</span></div>'
  ).join("") || '<div class="dim" style="padding:6px 10px;font-size:12px">none yet</div>';
  $("nav").innerHTML = NAV.map(([id,ic,name]) =>
    '<div class="navItem '+(state.tab===id&&!state.admin?"sel":"")+'" onclick="goTab(\\''+id+'\\')"><span class="ic">'+ic+'</span> '+name+'</div>').join("");
  $("navAdmin").className = "navItem"+(state.admin?" sel":"");
}
function goTab(t){ state.admin=false; state.tab=t; renderSide(); render(); }
async function select(id){ state.admin=false; state.sel = id; state.tab = "overview"; renderSide(); await refreshProject(); }
async function refreshProject(){
  const id = state.sel; if(!id) return render();
  const [paths, report, triage, jobs, artifacts] = await Promise.all([
    api("/api/projects/"+id+"/paths"), api("/api/projects/"+id+"/report"),
    api("/api/projects/"+id+"/triage"), api("/api/projects/"+id+"/jobs"), api("/api/projects/"+id+"/artifacts"),
  ]);
  Object.assign(state, { paths, report: report.report ?? null, triage, jobs, artifacts });
  renderSide(); render();
}
function proj(){ return state.projects.find(p=>p.id===state.sel); }
function showNew(){ state.sel=null; state.admin=false; renderSide(); render(true); }

function render(newForm){
  const m = $("main");
  if (state.admin) return; // admin renders itself
  if (newForm || !proj()) { m.innerHTML = '<div class="crumbs">projects</div><div class="pageHead"><h1>New project</h1></div>' + projectForm(); return; }
  const p = proj();
  const views = {overview:overviewView, verify:verifyView, journeys:journeysView, issues:issuesView, understand:understandView, studio:studioView, artifacts:artifactsView, history:historyView, settings:settingsView};
  m.innerHTML =
    '<div class="crumbs">projects / '+esc(p.id)+'</div>'+
    '<div class="pageHead"><h1>'+esc(p.name)+'</h1><span class="urlChip">'+esc(p.baseUrl)+'</span>'+(p.repoRoot?'<span class="badge">source connected</span>':'<span class="badge amber">UX-only</span>')+'</div>'+
    views[state.tab](p);
  if (state.tab==="understand") loadUnderstand();
  if (state.tab==="studio") loadStudio();
}

/* ---------- overview ---------- */
function lastJob(stage){ return state.jobs.find(j=>j.stage===stage); }
function overviewView(p){
  const d = lastJob("discover"), r = state.report;
  const nodes = d && d.summary ? d.summary.nodes : "–";
  const passed = state.paths.filter(x=>x.status==="passed"||x.status==="approved").length;
  const issues = r ? (r.issues||[]).length : "–";
  const crit = r ? (r.issues||[]).filter(i=>i.severity==="critical"||i.severity==="high").length : 0;
  const vids = state.artifacts.filter(a=>a.rel.endsWith(".mp4"));
  return '<div class="grid c4">'+
    '<div class="stat"><div class="v">'+nodes+'</div><div class="l">screens discovered</div><div class="s dim">'+(d?relTime(d.startedAt):"never crawled")+'</div></div>'+
    '<div class="stat"><div class="v">'+state.paths.length+'</div><div class="l">journeys planned</div><div class="s dim">'+passed+' approved/passed</div></div>'+
    '<div class="stat"><div class="v" style="color:'+(crit?"var(--red)":"var(--fg)")+'">'+issues+'</div><div class="l">open findings</div><div class="s dim">'+crit+' high or critical</div></div>'+
    '<div class="stat"><div class="v">'+vids.length+'</div><div class="l">videos rendered</div><div class="s dim">'+(vids[0]?relTime(vids[0].mtime):"none yet")+'</div></div>'+
  '</div>'+
  '<h3>What do you want to do?</h3><div class="grid c3">'+
    '<div class="card"><h2>✓ &nbsp;Verify this build</h2><p class="muted" style="font-size:13px;margin:4px 0 14px">Crawl every screen, execute the critical journeys, get a ranked defect report.</p><button class="btn" onclick="goTab(\\'verify\\')">Open pipeline</button></div>'+
    '<div class="card"><h2>▶ &nbsp;Make a video</h2><p class="muted" style="font-size:13px;margin:4px 0 14px">Write a script in plain prose; ProdLens grounds it in real screens and renders a narrated demo.</p><button class="btn" onclick="goTab(\\'studio\\')">Open studio</button></div>'+
    '<div class="card"><h2>◎ &nbsp;Understand the product</h2><p class="muted" style="font-size:13px;margin:4px 0 14px">Reverse-engineer the architecture, define vision, annotate what the AI got wrong.</p><button class="btn" onclick="goTab(\\'understand\\')">Open respec</button></div>'+
  '</div>'+
  (vids.length?'<h3>Latest render</h3><div class="card"><video controls preload="metadata" src="/api/projects/'+state.sel+'/file?path='+encodeURIComponent(vids[0].rel)+'"></video>'+
    '<div style="margin-top:10px">'+vids.slice(0,5).map(v=>'<div><a href="/api/projects/'+state.sel+'/file?path='+encodeURIComponent(v.rel)+'" target="_blank">'+esc(v.rel.split("/").pop())+'</a> <span class="dim">'+(v.size/1e6).toFixed(1)+' MB · '+relTime(v.mtime)+'</span></div>').join("")+'</div></div>':'')+
  '<h3>Recent activity</h3>'+(state.jobs.length?'<div class="card" style="padding:6px 20px"><table>'+state.jobs.slice(0,6).map(j=>
    '<tr><td style="width:130px"><b>'+esc(j.stage)+'</b></td><td style="width:110px"><span class="badge '+esc(j.status)+'">'+esc(j.status)+'</span></td><td class="dim">'+relTime(j.startedAt)+'</td><td class="muted" style="font-size:12px">'+esc(j.summary?shortSummary(j.summary):(j.error||"")).slice(0,110)+'</td></tr>').join("")+'</table></div>'
    :'<div class="empty"><div class="big">🛰</div><b>Nothing has run yet.</b><br>Start with <a onclick="goTab(\\'verify\\')" style="cursor:pointer">Verify</a> - discovery takes about two minutes.</div>');
}
function shortSummary(s){ return Object.entries(s).filter(([k])=>!/path|Path/.test(k)).map(([k,v])=>k+" "+v).join(" · "); }
function relTime(iso){ if(!iso) return ""; const m = Math.round((Date.now()-new Date(iso).getTime())/60000); if(m<1)return "just now"; if(m<60)return m+"m ago"; const h=Math.round(m/60); if(h<24)return h+"h ago"; return Math.round(h/24)+"d ago"; }

/* ---------- verify (pipeline stepper) ---------- */
const STAGES = [
  { s:"discover", n:"Discover", d:"Live crawl: every screen, link and button" },
  { s:"prioritize", n:"Prioritize", d:"AI plans the critical user journeys" },
  { s:"review", n:"Review", d:"You approve, reject or edit each journey", gate:true },
  { s:"run", n:"Run", d:"Execute approved journeys on the live app" },
  { s:"report", n:"Report", d:"Diff intended vs actual, rank the findings" },
];
function stageState(stage){
  if (stage==="review"){ const anyDecided = state.paths.some(x=>x.status!=="planned"); const any = state.paths.length; return any? (anyDecided?"done":"gate") : ""; }
  const j = lastJob(stage); if(!j) return "";
  return j.status==="done"?"done":(j.status==="running"||j.status==="queued")?"live":"err";
}
function verifyView(p){
  const extra = [
    { s:"visual", n:"Visual QA", d:"Vision model reads every screenshot", off:false },
    { s:"scan", n:"Scan", d:"Static source pass", off:!p.repoRoot },
    { s:"respec", n:"Respec", d:"Reverse-engineer code → spec", off:false },
  ];
  return '<div class="stepper">'+STAGES.map((x,i)=>{
    const st = stageState(x.s);
    const j = lastJob(x.s);
    const body = x.gate
      ? '<button class="btn ghost sm" onclick="goTab(\\'journeys\\')">Review journeys</button>'
      : '<button class="btn sm" onclick="runStage(\\''+x.s+'\\')">'+(st==="live"?'<span class="spin"></span> running':'Run')+'</button>';
    return '<div class="step '+st+'"><div class="num">'+(st==="done"?"✓":st==="err"?"!":(i+1))+'</div><div class="sn">'+x.n+'</div><div class="sd">'+x.d+'</div>'+body+
      (j&&j.summary?'<div class="sm2">'+esc(shortSummary(j.summary)).slice(0,90)+'</div>':j&&j.error?'<div class="sm2" style="color:var(--red)">'+esc(j.error.slice(0,80))+'</div>':'')+'</div>';
  }).join("")+'</div>'+
  '<h3>More passes</h3><div class="grid c3">'+extra.map(x=>{
    const j = lastJob(x.s);
    return '<div class="card'+(x.off?' ' :'')+'" style="'+(x.off?"opacity:.45":"")+'"><h2 style="font-size:14px">'+x.n+'</h2><div class="muted" style="font-size:12px;margin:2px 0 12px">'+(x.off?"Connect a repo in Settings to enable":x.d)+'</div>'+
    '<button class="btn ghost sm" '+(x.off?"disabled":"")+' onclick="runStage(\\''+x.s+'\\')">Run</button>'+
    (j&&j.summary?'<div class="sm2" style="margin-top:8px;font-size:11px" class="muted">'+esc(shortSummary(j.summary)).slice(0,90)+'</div>':'')+'</div>';
  }).join("")+'</div>'+
  '<h3>Environment</h3><div class="card"><button class="btn ghost sm" onclick="runPreflight()">Run preflight checks</button> <span id="pf" class="dim"></span><div id="pfout"></div></div>';
}
async function runPreflight(){
  $("pf").textContent = "checking…";
  const checks = await api("/api/projects/"+state.sel+"/preflight");
  $("pf").textContent = "";
  $("pfout").innerHTML = '<table style="margin-top:10px">'+checks.map(c=>
    '<tr><td style="width:60px"><span class="badge '+(c.ok?"green":"red")+'">'+(c.ok?"ok":"fix")+'</span></td><td style="width:190px"><b>'+esc(c.name)+'</b></td>'+
    '<td class="muted" style="font-size:12.5px">'+esc(c.detail)+(c.fix?' — <b style="color:var(--amber)">'+esc(c.fix)+'</b>':"")+'</td></tr>').join("")+'</table>';
}
async function runStage(stage){
  try {
    const { jobId } = await post("/api/projects/"+state.sel+"/stages/"+stage);
    openConsole(stage);
    watchJob(jobId);
    render();
  } catch(e){ toast(String(e.message||e), 6000); }
}

/* ---------- console drawer ---------- */
const STAGE_SPEAK = {
  discover: "Meera (QA) is crawling every screen and clicking every button — ~2 min. You'll get a coverage map.",
  prioritize: "Meera is planning the critical user journeys from the map — ~1 min. You'll review them next.",
  run: "Meera is executing the approved journeys on the live app — a browser window may open. ~2-4 min.",
  report: "Meera is diffing intended vs actual and ranking findings — seconds. Check the Issues tab after.",
  visual: "Meera is reading every screenshot with a vision model — ~1-2 min. Findings fold into the report.",
  scan: "Dev (engineer) is statically scanning the source for wiring bugs — ~30s, no browser.",
  respec: "Asha (architect) is reverse-engineering the product into a spec — ~1 min. Review it in Understand.",
  "render draft": "Priya (PM) is recording a silent draft cut — a browser window will drive your app. ~3-6 min.",
  "render final": "Priya (PM) is recording and narrating the final cut — ~4-8 min. It lands in Studio and Overview.",
};
function toggleConsole(){ $("console").classList.toggle("open"); }
function openConsole(title){
  const c=$("console"); c.classList.add("open","running");
  $("consoleTitle").textContent="Console · "+title;
  $("consoleStatus").textContent = STAGE_SPEAK[title] || "running";
  $("consoleLog").textContent="";
}
function watchJob(jobId){
  if (state.es) state.es.close();
  const es = new EventSource("/api/projects/"+state.sel+"/jobs/"+jobId+"/events");
  state.es = es;
  es.onmessage = (ev)=>{
    const d = JSON.parse(ev.data);
    if (d.line){ const L=$("consoleLog"); L.textContent += d.line+"\\n"; L.scrollTop = L.scrollHeight; }
    if (d.status && d.status!=="running" && d.status!=="queued"){
      es.close(); state.es=null;
      $("console").classList.remove("running");
      $("consoleStatus").textContent = d.status + (d.summary?" · "+shortSummary(d.summary).slice(0,80):"");
      toast((d.status==="done"?"✓ ":"✗ ")+$("consoleTitle").textContent.replace("Console · ","")+" "+d.status, 5000);
      refreshProject();
    }
  };
}

/* ---------- journeys ---------- */
function journeysView(){
  if (!state.paths.length) return '<div class="empty"><div class="big">➜</div><b>No journeys planned yet.</b><br>Run <a style="cursor:pointer" onclick="goTab(\\'verify\\')">Prioritize</a> first - the AI proposes them from the discovered graph.</div>';
  return '<div class="card" style="padding:6px 20px"><table><tr><th style="width:90px">priority</th><th>goal (click to edit)</th><th style="width:60px">steps</th><th style="width:100px">status</th><th style="width:170px"></th></tr>'+
  state.paths.map(x=>'<tr><td><span class="badge '+esc(x.priority)+'">'+esc(x.priority)+'</span></td>'+
    '<td><input value="'+esc(x.goal)+'" onchange="editGoal(\\''+x.id+'\\',this.value)" style="background:transparent;border-color:transparent;padding:4px 6px"></td>'+
    '<td class="muted">'+x.steps.length+'</td><td><span class="badge '+esc(x.status)+'">'+esc(x.status)+'</span></td>'+
    '<td><button class="btn ok sm" onclick="review(\\''+x.id+'\\',true)">approve</button> <button class="btn danger sm" onclick="review(\\''+x.id+'\\',false)">reject</button></td></tr>').join("")+
  '</table></div><button class="btn ghost sm" onclick="reviewAll()">Approve all planned</button> <button class="btn sm" style="margin-left:8px" onclick="runStage(\\'run\\')">Run approved journeys →</button>';
}
const goalEdits = {};
function editGoal(id, goal){ goalEdits[id]=goal; }
async function review(id, ok){
  const body = { edits: Object.entries(goalEdits).map(([id,goal])=>({id,goal})) };
  body[ok?"approve":"reject"] = [id];
  state.paths = await post("/api/projects/"+state.sel+"/paths/review", body);
  render();
}
async function reviewAll(){
  const ids = state.paths.filter(x=>x.status==="planned").map(x=>x.id);
  state.paths = await post("/api/projects/"+state.sel+"/paths/review", { approve: ids });
  render(); toast(ids.length+" journeys approved");
}

/* ---------- issues ---------- */
function issuesView(){
  const r = state.report;
  if (!r) return '<div class="empty"><div class="big">⚑</div><b>No verification report yet.</b><br>Run the pipeline through <a style="cursor:pointer" onclick="goTab(\\'verify\\')">Report</a>.</div>';
  const s = r.summary||{};
  return '<div class="grid c4" style="margin-bottom:16px">'+
    '<div class="stat"><div class="v">'+(r.issues||[]).length+'</div><div class="l">findings</div></div>'+
    '<div class="stat"><div class="v">'+(s.nodesCovered??"–")+'</div><div class="l">screens covered</div></div>'+
    '<div class="stat"><div class="v">'+(s.brokenTransitions??"–")+'</div><div class="l">broken transitions</div></div>'+
    '<div class="stat"><div class="v">'+(s.deadEnds??"–")+'</div><div class="l">dead ends</div></div></div>'+
  (r.issues||[]).map(i=>{
    const t = state.triage[i.id];
    return '<div class="issue '+esc(i.severity)+'"><span class="badge '+esc(i.severity)+'" style="margin-top:2px">'+esc(i.severity)+'</span>'+
    '<div style="flex:1"><b>'+esc(i.title)+'</b><div class="muted" style="font-size:12.5px;margin-top:2px">'+esc(i.description||"")+'</div></div>'+
    '<div style="flex-shrink:0">'+(t?'<span class="badge '+(t.verdict==="confirmed"?"green":t.verdict==="env"?"amber":"red")+'">'+esc(t.verdict)+'</span>':
      '<button class="btn ok sm" onclick="triage(\\''+i.id+'\\',\\'confirmed\\')">real</button> '+
      '<button class="btn danger sm" onclick="triage(\\''+i.id+'\\',\\'false-positive\\')">false</button> '+
      '<button class="btn ghost sm" onclick="triage(\\''+i.id+'\\',\\'env\\')">env</button>')+'</div></div>';
  }).join("");
}
async function triage(issueId, verdict){
  state.triage = await post("/api/projects/"+state.sel+"/triage", { issueId, verdict });
  render(); toast("triage saved → feeds GEPA");
}

/* ---------- understand ---------- */
function understandView(p){
  return '<div class="grid c2"><div class="card"><h2>Vision <span class="dim" style="font-weight:400;font-size:11px">gate 1 · feeds every AI stage</span></h2>'+
  '<textarea id="vision" style="min-height:170px" placeholder="Goals, audiences, key features, what to show / what to avoid…"></textarea>'+
  '<div style="margin-top:10px"><button class="btn sm" onclick="saveVision()">Save vision</button> '+
  '<button class="btn ghost sm" onclick="runStage(\\'respec\\')">Regenerate respec '+(p.repoRoot?"":"(graph-only)")+'</button></div></div>'+
  '<div class="card"><h2>How this works</h2><p class="muted" style="font-size:13px">ProdLens reads '+(p.repoRoot?"the source, docs and the discovered graph":"the discovered graph (no source connected)")+' and writes what the product actually is: components, capabilities, key flows and doc-drift. Your annotations below are authoritative - regeneration never overwrites them.</p></div></div>'+
  '<div id="respec"><div class="dim">loading…</div></div>';
}
async function loadUnderstand(){
  const [v, r] = await Promise.all([api("/api/projects/"+state.sel+"/vision"), api("/api/projects/"+state.sel+"/respec")]);
  const el = $("vision"); if (el) el.value = v.text;
  const out = $("respec"); if (!out) return;
  const spec = r.respec;
  if (!spec) { out.innerHTML = '<div class="empty"><div class="big">◎</div><b>No respec yet.</b><br>Click "Regenerate respec" - about a minute.</div>'; return; }
  out.innerHTML =
    '<h3>Reverse-engineered spec <span class="badge">'+esc(spec.source)+'</span></h3>'+
    '<div class="card"><b>'+esc(spec.oneLiner)+'</b></div>'+
    '<h3>Topology · '+spec.topology.length+' components</h3><div class="card" style="padding:6px 20px"><table>'+spec.topology.map(c=>
      '<tr><td style="width:220px"><b>'+esc(c.name)+'</b><br><span class="badge">'+esc(c.kind)+(c.port?' :'+esc(c.port):'')+'</span></td><td class="muted" style="font-size:12.5px">'+esc(c.role)+'</td>'+
      '<td style="width:230px"><input placeholder="annotate…" value="'+esc(spec.annotations["topology:"+c.name]||"")+'" onchange="annotate(\\'topology:'+esc(c.name)+'\\',this.value)"></td></tr>').join("")+'</table></div>'+
    (spec.flows.length?'<h3>Key flows</h3><div class="grid c2">'+spec.flows.map(f=>'<div class="card"><b>'+esc(f.name)+'</b><div class="muted mono" style="font-size:11.5px;margin-top:8px;line-height:1.9">'+f.steps.map(s=>esc(s.from)+' → '+esc(s.to)+' <span class="dim">· '+esc(s.action)+'</span>').join("<br>")+'</div></div>').join("")+'</div>':'')+
    (spec.drift.length?'<h3>Drift report</h3>'+spec.drift.map(d=>'<div class="issue '+(d.status==="confirmed"?"low":"medium")+'"><span class="badge '+(d.status==="confirmed"?"green":"amber")+'">'+esc(d.status)+'</span><div>'+esc(d.claim)+' <span class="dim">('+esc(d.source)+')</span></div></div>').join(""):'');
}
async function saveVision(){ await put("/api/projects/"+state.sel+"/vision", { text: $("vision").value }); toast("vision saved"); }
async function annotate(key, note){ await post("/api/projects/"+state.sel+"/respec/annotate", { key, note }); toast("annotation saved"); }

/* ---------- studio ---------- */
let studioMeta = null;
const SCENE_ICON = { login:"🔐", screen:"🖥", diagram:"🗺", card:"🎬", call:"📞", artifact:"▤" };
function studioView(){
  return '<div class="card"><h2>Start from…</h2><div class="row2">'+
  '<div><label>A one-line brief</label><input id="oneLiner" placeholder="90-second video convincing a call-center head to try us">'+
  '<button class="btn ghost sm" style="margin-top:8px" onclick="draftFrom({oneLiner:$(\\'oneLiner\\').value})">Draft script</button></div>'+
  '<div><label>A viewer role <span class="dim">(role-scoped workflow video)</span></label><select id="rolePick"><option value="">loading roles…</option></select>'+
  '<button class="btn ghost sm" style="margin-top:8px" onclick="draftFrom({role:$(\\'rolePick\\').value})">Draft role workflow</button></div>'+
  '<div><label>lazy-dist vision/strategy</label><div class="dim" style="font-size:12px;padding:8px 0">import positioning as script seed</div><button class="btn ghost sm" disabled title="integration - spec 13.6">Connect lazy-dist</button></div>'+
  '</div></div>'+
  '<div class="grid c2"><div class="card"><h2>Script <span class="dim" style="font-weight:400;font-size:11px">prose beats · "quoted lines" kept verbatim</span></h2>'+
  '<textarea id="script" style="min-height:180px" placeholder="Open on the sign-in page and log in. Then show how an agent is created…"></textarea>'+
  '<div class="row2" style="margin-top:4px"><div><label>Audience</label><select id="audience" onchange="filterFrames()"></select></div><div><label>Story frame <span class="dim">(filtered by audience)</span></label><select id="frame"></select></div></div>'+
  '<div style="margin-top:14px"><button class="btn sm" onclick="compile()">Compile → storyboard</button> '+
  '<button class="btn ghost sm" onclick="saveScriptText()">Save</button></div></div>'+
  '<div class="card"><h2>Render</h2><p class="muted" style="font-size:13px">Draft = silent, fast review cut. Final = narrated with the cast voice, captions burned in. A browser window opens and drives the live app.</p>'+
  '<div style="margin-top:10px"><button class="btn ghost sm" onclick="renderStudio(true)">Render draft</button> '+
  '<button class="btn sm" onclick="renderStudio(false)">Render final</button></div>'+
  '<div id="latestVideo" style="margin-top:14px"></div></div></div>'+
  '<div id="storyboard"><div class="dim">loading…</div></div>';
}
async function loadStudio(){
  if (!studioMeta) studioMeta = await api("/api/studio/meta");
  const s = await api("/api/projects/"+state.sel+"/studio");
  state.studio = s;
  const el = $("script"); if (el && !el.value) el.value = s.script;
  const aud = $("audience");
  if (aud && !aud.options.length){
    aud.innerHTML = studioMeta.audiences.map(a=>'<option value="'+a.id+'" '+((s.spec&&s.spec.audience)===a.id?"selected":"")+'>'+a.id+' — '+esc(a.who)+'</option>').join("");
    filterFrames(s.spec && s.spec.frame);
  }
  api("/api/projects/"+state.sel+"/roles").then(r=>{
    const rp = $("rolePick"); if (!rp) return;
    rp.innerHTML = (r.roles||[]).length ? r.roles.map(x=>'<option>'+esc(x)+'</option>').join("") : '<option value="">no roles yet - run respec</option>';
  }).catch(()=>{});
  renderStoryboard();
}
function filterFrames(selected){
  const aud = $("audience"), fr = $("frame"); if (!aud || !fr) return;
  const a = aud.value;
  const fit = studioMeta.frames.filter(f=>f.defaultAudience===a);
  const rest = studioMeta.frames.filter(f=>f.defaultAudience!==a);
  fr.innerHTML = '<option value="">no frame</option>'+
    fit.map(f=>'<option value="'+f.id+'" '+(selected===f.id?"selected":"")+'>'+f.id+' ✓</option>').join("")+
    '<optgroup label="advanced (other audiences)">'+rest.map(f=>'<option value="'+f.id+'" '+(selected===f.id?"selected":"")+'>'+f.id+'</option>').join("")+'</optgroup>';
}
async function draftFrom(src){
  if (src.oneLiner!==undefined && !src.oneLiner.trim()) return toast("type a one-line brief first");
  if (src.role!==undefined && !src.role) return toast("run respec first to get roles");
  toast("drafting script from product evidence…");
  try {
    const r = await post("/api/projects/"+state.sel+"/studio/draft-script", Object.assign({ audience: $("audience") ? $("audience").value : undefined }, src));
    $("script").value = r.script;
    toast("✓ script drafted - review it, then Compile");
  } catch(e){ toast("draft failed: "+e.message, 6000); }
}
function rendersHtml(s){
  if (!s || !s.videos || !s.videos.length) return "";
  return '<h3>Renders</h3><video controls preload="metadata" src="/api/projects/'+state.sel+'/file?path='+encodeURIComponent(s.videos[0].rel)+'"></video>'+
    '<div style="margin-top:8px">'+s.videos.map(v=>'<div><a href="/api/projects/'+state.sel+'/file?path='+encodeURIComponent(v.rel)+'" target="_blank">'+esc(v.rel.split("/").pop())+'</a> <span class="dim">'+(v.size/1e6).toFixed(1)+' MB · '+relTime(v.mtime)+'</span></div>').join("")+'</div>';
}
function renderStoryboard(){
  const s = state.studio; const out = $("storyboard"); if (!out) return;
  const lv = $("latestVideo");
  if (lv) lv.innerHTML = (s && s.videos && s.videos.length) ? '<a href="/api/projects/'+state.sel+'/file?path='+encodeURIComponent(s.videos[0].rel)+'" target="_blank">▶ '+esc(s.videos[0].rel.split("/").pop())+'</a> <span class="dim">'+relTime(s.videos[0].mtime)+'</span>' : "";
  if (!s || !s.spec){ out.innerHTML = '<div class="empty"><div class="big">▶</div><b>No storyboard yet.</b><br>Write a script and hit Compile - ProdLens grounds every beat in real screens.</div>' + rendersHtml(s); return; }
  const narrOf = (sc) => (s.narration&&s.narration.lines||[]).find(x=>x.sceneId===sc.id) || null;
  let html = "";
  // group scenes by act, keep order
  let act = null, row = [];
  const flush = () => { if(row.length){ html += '<div class="sceneRow">'+row.join("")+'</div>'; row=[]; } };
  for (const sc of s.spec.scenes){
    if ((sc.act||null) !== act){ flush(); act = sc.act||null; if(act) html += '<div class="actHead">'+esc(act)+'</div>'; }
    const l = narrOf(sc);
    row.push('<div class="scene"><div class="st"><span class="ic">'+(SCENE_ICON[sc.type]||"▦")+'</span>'+esc(sc.type)+'</div>'+
      '<div class="target">'+esc(sc.goto||sc.click||sc.scenario||sc.title||"")+'</div>'+
      (l?'<textarea onchange="editLine(\\''+l.id+'\\',this.value)">'+esc(l.text)+'</textarea>':'<div class="dim" style="font-size:11px">no narration</div>')+'</div>');
  }
  flush();
  if (s.gaps.length) html += '<h3>Gap report · '+s.gaps.length+'</h3>'+s.gaps.map(g=>
    '<div class="gap"><b>'+esc(g.beat.slice(0,70))+'</b> — '+esc(g.reason)+(g.suggestion?' <span class="dim">→ '+esc(g.suggestion)+'</span>':"")+'</div>').join("");
  html += rendersHtml(s);
  out.innerHTML = html;
}
async function editLine(lineId, text){
  const s = state.studio; if (!s || !s.narration) return;
  const l = s.narration.lines.find(x=>x.id===lineId); if (l) l.text = text;
  await put("/api/projects/"+state.sel+"/studio/narration", s.narration);
  toast("line saved · pinned against recompiles");
}
async function saveScriptText(){ await put("/api/projects/"+state.sel+"/studio/script", { text: $("script").value }); toast("script saved"); }
async function compile(){
  await saveScriptText(); toast("compiling…");
  try {
    const r = await post("/api/projects/"+state.sel+"/studio/compile", { audience: $("audience").value, frame: $("frame").value || undefined });
    state.studio = Object.assign(state.studio||{}, { spec: r.spec, narration: r.narration, gaps: r.gaps, videos: (state.studio&&state.studio.videos)||[] });
    renderStoryboard();
    toast("✓ "+r.spec.scenes.length+" scenes, "+r.gaps.length+" gaps");
  } catch(e){ toast("compile failed: "+e.message, 6000); }
}
async function renderStudio(draft){
  try {
    const { jobId } = await post("/api/projects/"+state.sel+"/studio/render", { draft });
    openConsole(draft?"render draft":"render final");
    watchJob(jobId);
  } catch(e){ toast(String(e.message||e), 6000); }
}

/* ---------- history + artifacts + settings ---------- */
function historyView(){
  if (!state.jobs.length) return '<div class="empty"><div class="big">⟳</div><b>No runs yet.</b></div>';
  return '<div class="card" style="padding:6px 20px"><table><tr><th>stage</th><th>status</th><th>started</th><th>result</th></tr>'+
  state.jobs.map(j=>'<tr><td><b>'+esc(j.stage)+'</b></td><td><span class="badge '+esc(j.status)+'">'+esc(j.status)+'</span></td>'+
  '<td class="dim">'+relTime(j.startedAt)+'</td><td class="muted" style="font-size:12px">'+esc(j.summary?shortSummary(j.summary):(j.error||"")).slice(0,140)+'</td></tr>').join("")+'</table></div>';
}
function artifactsView(){
  api("/api/projects/"+state.sel+"/registry").then(reg=>{
    const el = $("regList"); if (!el) return;
    el.innerHTML = reg.length ? '<div class="card" style="padding:6px 20px"><table><tr><th>artifact</th><th style="width:50px">ver</th><th>description</th><th style="width:100px">created</th></tr>'+
      reg.map(e=>'<tr><td><a href="/api/projects/'+state.sel+'/file?path='+encodeURIComponent(e.rel)+'" target="_blank"><b>'+esc(e.title)+'</b></a></td><td><span class="badge">v'+e.version+'</span></td>'+
      '<td class="muted" style="font-size:12px">'+esc(e.description)+'</td><td class="dim">'+relTime(e.createdAt)+'</td></tr>').join("")+'</table></div>' : "";
  }).catch(()=>{});
  if (!state.artifacts.length) return '<div class="empty"><div class="big">▤</div><b>Nothing yet.</b></div>';
  return '<h3>Registry <span class="dim" style="text-transform:none;letter-spacing:0">versioned + described - check here before re-creating</span></h3><div id="regList"></div>'+
  '<h3>All files</h3><div class="card" style="padding:6px 20px"><table><tr><th>artifact</th><th style="width:90px">size</th><th style="width:110px">modified</th></tr>'+
  state.artifacts.map(a=>'<tr><td><a href="/api/projects/'+state.sel+'/file?path='+encodeURIComponent(a.rel)+'" target="_blank" class="mono" style="font-size:12px">'+esc(a.rel)+'</a></td>'+
  '<td class="dim">'+(a.size>1e6?(a.size/1e6).toFixed(1)+" MB":Math.round(a.size/1e3)+" KB")+'</td>'+
  '<td class="dim">'+relTime(a.mtime)+'</td></tr>').join("")+'</table></div>';
}
function settingsView(p){ return projectForm(p); }
function projectForm(p){
  p = p || { name:"", baseUrl:"http://localhost:3000", entry:["/"], auth:{strategy:"none"} };
  return '<div class="card" style="max-width:620px">'+
  '<label>Name</label><input id="f_name" value="'+esc(p.name)+'">'+
  '<div class="row2"><div><label>Base URL <span class="dim">(live app - source optional)</span></label><input id="f_base" value="'+esc(p.baseUrl)+'"></div>'+
  '<div><label>Entry paths (comma-sep)</label><input id="f_entry" value="'+esc((p.entry||["/"]).join(","))+'"></div></div>'+
  '<div class="row2"><div><label>Auth strategy</label><select id="f_auth">'+
    ["none","custom-login","password","clerk-password","clerk-signup"].map(s=>'<option '+(p.auth&&p.auth.strategy===s?"selected":"")+'>'+s+'</option>').join("")+
  '</select></div><div><label>Token in localStorage</label><select id="f_token"><option value="no" '+(!(p.auth&&p.auth.tokenInLocalStorage)?"selected":"")+'>no</option><option value="yes" '+(p.auth&&p.auth.tokenInLocalStorage?"selected":"")+'>yes</option></select></div></div>'+
  '<div class="row2"><div><label>Login email '+(p.hasCredentials?'<span class="badge green">stored</span>':"")+'</label><input id="f_email" placeholder="(unchanged)"></div>'+
  '<div><label>Login password</label><input id="f_pass" type="password" placeholder="(unchanged)"></div></div>'+
  '<h3 style="margin-top:18px">Product sources <span class="dim" style="text-transform:none;letter-spacing:0">required for onboarding - at least one beyond the URL</span></h3>'+
  '<label>Repo root <span class="dim">(optional - read-only access only; enables scan + code-grounded respec)</span></label><input id="f_repo" value="'+esc(p.repoRoot||"")+'">'+
  '<label>App dir <span class="dim">(for scan, e.g. &lt;repo&gt;/src/app)</span></label><input id="f_appdir" value="'+esc(p.appDir||"")+'">'+
  '<label>Other sources <span class="dim">(docs links, notion, one per line)</span></label><textarea id="f_sources" style="min-height:56px">'+esc((p.sources||[]).join("\\n"))+'</textarea>'+
  '<div style="margin-top:16px"><button class="btn" onclick="saveProject(\\''+(p.id||"")+'\\')">Save project</button> '+
  (p.id?'<button class="btn danger sm" onclick="delProject(\\''+p.id+'\\')">Delete</button>':"")+'</div></div>';
}
async function saveProject(id){
  const body = {
    id: id || undefined, name: $("f_name").value.trim(), baseUrl: $("f_base").value.trim(),
    entry: $("f_entry").value.split(",").map(s=>s.trim()).filter(Boolean),
    auth: { strategy: $("f_auth").value, tokenInLocalStorage: $("f_token").value==="yes" },
    repoRoot: $("f_repo").value.trim() || undefined, appDir: $("f_appdir").value.trim() || undefined,
    sources: $("f_sources").value.split("\\n").map(s=>s.trim()).filter(Boolean),
    email: $("f_email").value, password: $("f_pass").value,
  };
  if(!body.name || !body.baseUrl) return toast("name + base URL required");
  if(!body.repoRoot && !body.sources.length) return toast("onboarding needs at least one product source (repo or docs links)");
  const saved = await post("/api/projects", body);
  toast("✓ project saved"); state.sel = saved.id; await loadProjects();
}
async function delProject(id){
  if(!confirm("Delete project config? (artifacts on disk are kept)")) return;
  await api("/api/projects/"+id, { method:"DELETE" }); state.sel=null; await loadProjects();
}

/* ---------- admin ---------- */
async function showAdmin(){
  state.admin = true; renderSide();
  const m = $("main");
  m.innerHTML = '<div class="crumbs">account</div><div class="pageHead"><h1>Costs &amp; pricing</h1></div><div id="adminBody" class="dim">loading…</div>';
  const [u, p] = await Promise.all([api("/api/admin/usage"), api("/api/admin/pricing")]);
  const usd = (micros) => "$" + (micros/1e6).toFixed(3);
  const projRows = Object.entries(u.summary.byProject).map(([pid, d]) => {
    const cap = (u.budgets[pid] && u.budgets[pid].monthlyCapUsd) ?? u.defaultCapUsd;
    const spent = d.totalUsdMicros/1e6;
    const pct = cap>0 ? Math.min(100, Math.round(spent/cap*100)) : 0;
    const buckets = Object.entries(d.byBucket).map(([b, v]) => b+" "+v.units.toFixed(0)+" ("+usd(v.usdMicros)+")").join(" · ");
    return '<tr><td><b>'+esc(pid)+'</b></td><td>'+usd(d.totalUsdMicros)+'</td>'+
      '<td><div class="capbar"><div style="background:'+(pct>=100?"var(--red)":pct>=80?"var(--amber)":"var(--green)")+';width:'+pct+'%"></div></div><span class="dim" style="font-size:11px">'+pct+'% of $'+cap+'</span></td>'+
      '<td class="muted" style="font-size:11.5px">'+esc(buckets)+'</td>'+
      '<td><input type="number" value="'+cap+'" style="width:80px" onchange="setCap(\\''+pid+'\\',this.value)"></td></tr>';
  }).join("") || '<tr><td colspan="5" class="dim">no spend recorded this month yet</td></tr>';
  const tierCards = p.tiers.map(t => {
    const price = t.priceUsd === "custom" ? "Custom" : (t.priceUsd===0?"$0":"$"+t.priceUsd+"<span class=dim style=font-size:13px>/mo</span>");
    const margin = t.priceUsd !== "custom" && t.priceUsd > 0 ? Math.round((1 - t.estCogsAtFullUseUsd/t.priceUsd)*100)+"% margin at full use" : (t.priceUsd===0 ? "COGS $"+t.estCogsAtFullUseUsd+" · acquisition" : "priced per deal");
    return '<div class="tierCard'+(t.id==="team"?" hot":"")+'"><b>'+esc(t.name)+'</b><div class="price">'+price+'</div>'+
      '<div class="muted" style="font-size:12px">'+esc(t.tagline)+'</div>'+
      '<div class="dim" style="font-size:11.5px;margin-top:8px">'+esc(String(t.quotas.projects))+' projects · '+esc(String(t.quotas.videosPerMonth))+' videos · '+esc(String(t.quotas.qaRunsPerMonth))+' QA runs · '+esc(String(t.quotas.seats))+' seats</div>'+
      '<ul>'+t.features.map(f=>'<li>'+esc(f)+'</li>').join("")+'</ul>'+
      '<div class="dim" style="font-size:11px;margin-top:auto;padding-top:10px">'+esc(margin)+'</div></div>';
  }).join("");
  $("adminBody").innerHTML =
    '<div class="grid c4"><div class="stat"><div class="v">'+usd(u.summary.totalUsdMicros)+'</div><div class="l">estimated spend · '+esc(u.summary.month)+'</div></div>'+
    '<div class="stat"><div class="v">$'+p.unitEconomics.qaRunCogsUsd+'</div><div class="l">COGS per QA run</div></div>'+
    '<div class="stat"><div class="v">$'+p.unitEconomics.videoCogsUsd+'</div><div class="l">COGS per video</div></div>'+
    '<div class="stat"><div class="v">$'+u.defaultCapUsd+'</div><div class="l">default monthly cap</div></div></div>'+
    '<h3>Per-project spend &amp; budgets</h3><div class="card" style="padding:6px 20px"><table><tr><th>project</th><th>spend</th><th>vs cap</th><th>buckets</th><th>cap $/mo</th></tr>'+projRows+'</table></div>'+
    '<div class="dim" style="font-size:11.5px">Stages refuse to start past cap (HTTP 402) - the preflight-gate pattern. Estimates, not billing-grade metering.</div>'+
    '<h3>Pricing tiers</h3><div class="grid c4" style="align-items:stretch">'+tierCards+'</div>';
}
async function setCap(pid, v){ await post("/api/admin/budget", { projectId: pid, monthlyCapUsd: Number(v) }); toast("budget saved for "+pid); }

loadProjects();
</script>
</body>
</html>`;
