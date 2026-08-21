// Prodlens web app - a self-contained server for running LLM-drafted product
// walkthroughs from the browser. Serves a single-page UI, runs a walkthrough
// in-process, streams progress over SSE, answers the screen-capture consent
// as a web prompt, and serves the finished video.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, statSync, existsSync, mkdirSync, createReadStream } from "node:fs";
import { dirname, join } from "node:path";
import { setScreenCaptureConsentResolver } from "../execution/os-cursor.js";
import { runWalkthrough } from "../adapters/walkthrough.js";
import { APP_HTML } from "./app-ui.js";
import { publicProjects, getProject, saveProject, deleteProject, setSecrets, slugify, type Project } from "./registry.js";
import { newJob, getJob, listJobs, appendLog, persistJob, projectBusy, runCaptured, type StageName, type StageJob } from "./jobs.js";
import { runStage, getPaths, reviewPaths, getReport, getTriage, setTriage, listArtifacts, artifactPath, getRespec, getVision, setVision, authConfig, discoveryDir } from "./pipeline.js";
import { saveAnnotation } from "../respec/respec.js";
import { compileScript, draftScript, loadGraphForProject } from "../studio/compile.js";
import { getStudio, saveScript, saveCompiled, saveNarration, saveSpec, studioDir, listRegistry, registerArtifact, specHash } from "../studio/store.js";
import { renderSpec } from "../studio/render.js";
import { preflight } from "../studio/preflight.js";
import { AUDIENCES, FRAMES } from "../studio/types.js";
import type { NarrationDoc, DemoSpec2 } from "../studio/types.js";
import { summarize, listMonths, getBudgets, setBudget, preflightBlocked, recordCost, setUsageContext, DEFAULT_MONTHLY_CAP_USD } from "../usage/ledger.js";
import { TIERS, UNIT_ECONOMICS } from "./pricing.js";
import { probeDuration } from "../execution/explain.js";

export interface WebOptions {
  port?: number;
  /** Default repo root shown in the form (optional). */
  defaultRepo?: string;
  /** Default data dir shown in the form (optional). */
  defaultData?: string;
}

interface RunJob {
  id: string;
  status: "running" | "done" | "error";
  log: string[];
  consentPrompt?: string;
  consentWaiters: { what: string; resolve: (v: boolean) => void }[];
  stopRequested?: boolean;
  videoPath?: string;
  error?: string;
  plan?: unknown;
}

const jobs = new Map<string, RunJob>();

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) });
  res.end(data);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function startRun(job: RunJob, config: Record<string, unknown>): Promise<void> {
  const outPath = resolve(config.outPath as string);
  mkdirSync(dirname(outPath), { recursive: true });
  const dataDir = config.dataDir as string | undefined;
  // TTS backend: default to Gemini (best voice). Allow override via the form.
  const ttsBackend = (config.ttsBackend as string | undefined) ?? "gemini";
  if (ttsBackend) process.env.TTS_BACKEND = ttsBackend;
  // Immediate log line so the SSE stream has content right away.
  job.log.push(`[start] run ${job.id} | TTS=${ttsBackend} | osCursor=${Boolean(config.osCursor)}`);
  // Set the consent resolver so confirmScreenCapture prompts the browser.
  setScreenCaptureConsentResolver((what) => {
    job.consentPrompt = what;
    return new Promise<boolean>((resolve) => {
      job.consentWaiters.push({ what, resolve });
    });
  });

  try {
    const mode = (config.mode as string) ?? "walkthrough";
    if (mode === "demo") {
      // Reliable scripted demo: real selectors, real cursor motion, no LLM
      // drafting. Requires a demo-script.json path.
      const scriptPath = resolve(config.scriptPath as string);
      if (!config.scriptPath) throw new Error("mode=demo requires --scriptPath (a demo-script.json)");
      const { renderProductDemo } = await import("../execution/demo.js");
      const script = JSON.parse(readFileSync(scriptPath, "utf-8"));
      const auth = {
        strategy: (config.authStrategy as string) ?? "none",
        baseUrl: script.baseUrl ?? (config.baseUrl as string),
        protectedPath: script.entry ?? "/",
        email: config.authEmail as string | undefined,
        password: config.authPassword as string | undefined,
        localStorageToken: Boolean(config.authTokenInLocalstorage),
        storageStatePath: dataDir ? join(resolve(dataDir), "storage-state", "session.json") : undefined,
      } as unknown as import("../discovery/auth.js").AuthConfig;
      const result = await renderProductDemo(script, outPath, {
        auth,
        screenshotsDir: dirname(outPath) + "/screenshots",
        osCursor: Boolean(config.osCursor),
      });
      job.status = "done";
      job.videoPath = result.videoPath;
      job.log.push(`[done] demo written: ${result.videoPath} (${result.stepsRun} steps)`);
      return;
    }

    const result = await runWalkthrough(outPath, {
      repoRoot: config.repoRoot as string | undefined,
      dataDir,
      docDirs: config.docDirs as string[] | undefined,
      description: config.description as string | undefined,
      baseUrl: config.baseUrl as string | undefined,
      model: config.model as string | undefined,
      skipReview: true,
      osCursor: Boolean(config.osCursor),
      synthesize: Boolean(config.synthesize),
      auth: {
        strategy: (config.authStrategy as string) ?? "none",
        email: config.authEmail as string | undefined,
        password: config.authPassword as string | undefined,
        localStorageToken: Boolean(config.authTokenInLocalstorage),
        storageStatePath: dataDir ? join(resolve(dataDir), "storage-state", "session.json") : undefined,
      },
      onProgress: (stage, detail) => {
        const line = `[${stage}] ${detail ?? ""}`;
        job.log.push(line);
        console.log(line);
      },
      stopRequested: () => Boolean(job.stopRequested),
    });
    job.status = "done";
    job.videoPath = result.videoPath;
    job.plan = result.plan;
    job.log.push("[done] video written");
  } catch (e) {
    job.status = "error";
    job.error = e instanceof Error ? e.message : String(e);
    job.log.push(`[error] ${job.error}`);
  } finally {
    setScreenCaptureConsentResolver(undefined);
  }
}

function resolve(p: string): string {
  return join(process.cwd(), p);
}

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>prodlens - product walkthrough studio</title>
<style>
:root{--bg:#0b0d10;--fg:#e8e8e8;--muted:#9aa0a6;--panel:#16181d;--border:#262a31;--accent:#60a5fa;--green:#34d399;--red:#f87171;--amber:#fbbf24}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--fg)}
.wrap{max-width:960px;margin:0 auto;padding:32px 20px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:17px;margin:0 0 10px}
.sub{color:var(--muted);font-size:13px;margin-bottom:22px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:18px 20px;margin-bottom:16px}
label{display:block;font-size:12px;color:var(--muted);margin:10px 0 4px}
input,select,textarea{width:100%;background:#0f172a;border:1px solid var(--border);border-radius:8px;color:var(--fg);padding:8px 10px;font-size:13px;font-family:inherit}
textarea{min-height:64px;resize:vertical}
.row{display:flex;gap:12px}.row>div{flex:1}
.check{display:flex;align-items:center;gap:8px;margin-top:12px}
.check input{width:auto}
.btn{background:var(--accent);color:#08131f;font-weight:600;padding:10px 18px;border:0;border-radius:8px;font-size:14px;cursor:pointer;margin-top:14px}
.btn:disabled{opacity:.5;cursor:not-allowed}
#log{background:#0a0c0f;border:1px solid var(--border);border-radius:8px;padding:12px;font-family:ui-monospace,Menlo,monospace;font-size:12px;white-space:pre-wrap;height:220px;overflow:auto}
pre{background:#0a0c0f;border:1px solid var(--border);border-radius:8px;padding:12px;font-family:ui-monospace,Menlo,monospace;font-size:12px;white-space:pre-wrap;overflow-x:auto;line-height:1.6;margin:0}
#consent{display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);align-items:center;justify-content:center;z-index:10}
#consentBox{background:var(--panel);border:1px solid var(--accent);border-radius:12px;padding:24px;max-width:520px;width:90%}
#videoWrap{display:none}video{width:100%;border-radius:10px;border:1px solid var(--border);background:#000}
.badge{display:inline-block;font-size:11px;padding:2px 10px;border-radius:999px;margin-left:6px}
.badge.running{background:#0f172a;color:var(--accent);border:1px solid #1e3a5f}
.badge.done{background:#052e16;color:var(--green);border:1px solid #14532d}
.badge.error{background:#2a0a0a;color:var(--red);border:1px solid #701a1a}
</style>
</head>
<body>
<div class="wrap">
  <h1>prodlens <span class="badge" id="statusBadge" style="display:none">idle</span></h1>
  <p class="sub">LLM-drafted product walkthrough: the tool reads your repo, drafts a persona-first demo, and renders a narrated video with a real cursor.</p>

  <div class="card">
    <h2>Configure the run</h2>
    <div class="row">
      <div><label>Repo root</label><input id="repoRoot" value="/Users/karthiknaig/Projects/voicera_mono_repository"></div>
      <div><label>Base URL</label><input id="baseUrl" value="http://localhost:3200"></div>
    </div>
    <div class="row">
      <div><label>LLM model</label><input id="model" value="qwen/qwen3-32b"></div>
      <div><label>Discovery data dir</label><input id="dataDir" value="data/projects/voicera/discovery"></div>
    </div>
    <div class="row">
      <div><label>TTS backend</label>
        <select id="ttsBackend">
          <option value="gemini" selected>Gemini (neural, best voice)</option>
          <option value="kokoro">Kokoro (local, free)</option>
          <option value="auto">Auto (Gemini → Kokoro → say)</option>
        </select>
      </div>
      <div><label>Output MP4 path</label><input id="outPath" value="data/projects/voicera/demos/voicera-walkthrough/videos/voicera-walkthrough.mp4"></div>
    </div>
    <label>Description</label>
    <textarea id="description">VoiceEra: open voice AI infrastructure for India - build, deploy, and monitor AI voice assistants with telephony</textarea>
    <div class="row">
      <div><label>Auth strategy</label>
        <select id="authStrategy">
          <option value="none">none</option>
          <option value="custom-login" selected>custom-login</option>
          <option value="password">password</option>
          <option value="clerk-password">clerk-password</option>
        </select>
      </div>
      <div><label>Auth email</label><input id="authEmail" value="uft-demo-1786594772@example.com"></div>
    </div>
    <div class="row">
      <div><label>Auth password</label><input id="authPassword" type="password" value="DemoPass123!"></div>
    </div>
    <div class="check"><input id="osCursor" type="checkbox" checked><label for="osCursor" style="margin:0">Record real screen + OS cursor (will ask for consent)</label></div>
    <div class="check"><input id="authToken" type="checkbox" checked><label for="authToken" style="margin:0">Token in localStorage (custom-login)</label></div>
    <button class="btn" id="runBtn">Run walkthrough</button>
    <button class="btn" id="stopBtn" style="background:var(--red);color:#fff;margin-left:8px;display:none">Stop</button>
  </div>

  <div class="card">
    <h2>CLI quick reference</h2>
    <p style="font-size:13px;color:var(--muted);margin:0 0 10px">Everything the web app does is also available from the terminal (<code>prodlens &lt;command&gt;</code>).</p>
<pre># Verify a product: discover -> prioritize -> run -> report
prodlens full --base-url http://localhost:3200 --name my-app \
  --auth custom-login --auth-token-in-localstorage

# LLM-drafted persona-first walkthrough (headless)
prodlens walkthrough --out data/videos/walkthrough.mp4 \
  --repo-root /path/to/product --base-url http://localhost:3200 \
  --auth custom-login --auth-token-in-localstorage --skip-review

# Same, with the real OS cursor (asks for screen-capture consent)
prodlens walkthrough --out data/videos/walkthrough-os.mp4 \
  --repo-root /path/to/product --base-url http://localhost:3200 --os-cursor \
  --auth custom-login --auth-token-in-localstorage --skip-review

# Generate a product adapter from a repo, on the fly
prodlens adapter --repo-root /path/to/product

# Scripted narrated click-through demo
prodlens demo --script demo-script.json --out data/videos/demo.mp4 \
  --auth custom-login --auth-token-in-localstorage

# Other commands
prodlens scan|discover|prioritize|review|run|report|explore|visual|gepa|explain|capture|screens-to-video|record-screen</pre>
  </div>

  <div class="card">
    <h2>Progress</h2>
    <div id="log"></div>
  </div>

  <div class="card" id="videoWrap">
    <h2>Result</h2>
    <video id="video" controls></video>
  </div>
</div>

<div id="consent"><div id="consentBox">
  <h2>Screen capture consent</h2>
  <p id="consentText">prodlens wants to record your screen.</p>
  <button class="btn" id="consentYes" style="margin-right:8px">Allow recording</button>
  <button class="btn" id="consentNo" style="background:var(--panel);color:var(--fg);border:1px solid var(--border)">Deny</button>
</div></div>

<script>
const $ = (id) => document.getElementById(id);
let currentJob = null;
const logEl = $("log");
const badge = $("statusBadge");

function setBadge(text, cls) {
  badge.textContent = text;
  badge.className = "badge " + cls;
  badge.style.display = "inline-block";
}
function appendLog(line) {
  logEl.textContent += line + "\\n";
  logEl.scrollTop = logEl.scrollHeight;
}

$("runBtn").addEventListener("click", async () => {
  const config = {
    repoRoot: $("repoRoot").value,
    dataDir: $("dataDir").value,
    baseUrl: $("baseUrl").value,
    model: $("model").value,
    description: $("description").value,
    outPath: $("outPath").value || "data/videos/walkthrough.mp4",
    ttsBackend: $("ttsBackend").value,
    authStrategy: $("authStrategy").value,
    authEmail: $("authEmail").value,
    authPassword: $("authPassword").value,
    osCursor: $("osCursor").checked,
    authTokenInLocalstorage: $("authToken").checked,
  };

  // Immediate feedback: clear, disable, and say we're starting BEFORE any
  // network call, so the user always sees a reaction.
  logEl.textContent = "";
  $("videoWrap").style.display = "none";
  $("runBtn").disabled = true;
  $("stopBtn").style.display = "inline-block";
  setBadge("starting", "running");
  appendLog("[ui] starting run...");

  try {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      appendLog("[error] " + (body.error || ("HTTP " + res.status)));
      setBadge("error", "error");
      $("runBtn").disabled = false;
      $("stopBtn").style.display = "none";
      return;
    }
    if (!body.id) {
      appendLog("[error] run did not start (no id returned)");
      setBadge("error", "error");
      $("runBtn").disabled = false;
      $("stopBtn").style.display = "none";
      return;
    }
    const id = body.id;
    currentJob = id;
    appendLog("[ui] run " + id + " started - streaming progress...");

    const evt = new EventSource("/api/run/" + id + "/events");
    evt.onmessage = (m) => {
      const data = JSON.parse(m.data);
      if (data.line) appendLog(data.line);
      if (data.status === "done") {
        evt.close();
        setBadge("done", "done");
        $("runBtn").disabled = false;
        $("stopBtn").style.display = "none";
        appendLog("[ui] done - loading video...");
        $("video").src = "/api/run/" + id + "/video";
        $("videoWrap").style.display = "block";
      } else if (data.status === "error") {
        evt.close();
        setBadge("error", "error");
        $("runBtn").disabled = false;
        $("stopBtn").style.display = "none";
        appendLog("[error] run failed.");
      } else if (data.consentPrompt) {
        $("consentText").textContent = data.consentPrompt;
        $("consent").style.display = "flex";
      }
    };
    evt.onerror = () => {
      // EventSource auto-reconnects; only surface if we're not done yet.
      appendLog("[ui] waiting for progress...");
    };
  } catch (err) {
    appendLog("[error] " + (err instanceof Error ? err.message : String(err)));
    setBadge("error", "error");
    $("runBtn").disabled = false;
  }
});

$("stopBtn").addEventListener("click", async () => {
  if (!currentJob) return;
  appendLog("[ui] stop requested - waiting for the run to save...");
  await fetch("/api/run/" + currentJob + "/stop", { method: "POST", headers: { "Content-Type": "application/json" } });
});

$("consentYes").addEventListener("click", () => answerConsent(true));
$("consentNo").addEventListener("click", () => answerConsent(false));
async function answerConsent(allow) {
  $("consent").style.display = "none";
  await fetch("/api/run/" + currentJob + "/consent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ allow }),
  });
}
</script>
</body>
</html>`;

export function startWebServer(opts: WebOptions = {}): { port: number; close: () => Promise<void> } {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    // Static: the shadcn SPA (ui/app/dist) at /, the classic single-file UI at
    // /classic, the legacy walkthrough form at /legacy. Falls back to the
    // classic UI when the SPA hasn't been built.
    const distDir = join(process.cwd(), "ui", "app", "dist");
    if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/assets/") || url.pathname === "/vite.svg")) {
      const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const filePath = join(distDir, rel);
      if (existsSync(filePath) && filePath.startsWith(distDir)) {
        const type = filePath.endsWith(".html") ? "text/html; charset=utf-8"
          : filePath.endsWith(".js") ? "text/javascript" : filePath.endsWith(".css") ? "text/css"
          : filePath.endsWith(".svg") ? "image/svg+xml" : filePath.endsWith(".woff2") ? "font/woff2" : "application/octet-stream";
        res.writeHead(200, { "Content-Type": type, "Cache-Control": url.pathname === "/" ? "no-cache" : "public, max-age=31536000, immutable" });
        createReadStream(filePath).pipe(res);
        return;
      }
      if (url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(APP_HTML);
        return;
      }
    }
    if (url.pathname === "/classic" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(APP_HTML);
      return;
    }
    if (url.pathname === "/legacy" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(HTML);
      return;
    }

    // ---- Projects API (P1) ----
    if (url.pathname === "/api/projects" && req.method === "GET") {
      return sendJson(res, 200, publicProjects());
    }
    if (url.pathname === "/api/projects" && req.method === "POST") {
      try {
        const body = JSON.parse(await readBody(req)) as Record<string, unknown> & { email?: string; password?: string };
        if (!body.name || !body.baseUrl) return sendJson(res, 400, { error: "name and baseUrl are required" });
        const id = (body.id as string) || slugify(body.name as string);
        const project = saveProject({
          id,
          name: body.name as string,
          baseUrl: (body.baseUrl as string).replace(/\/$/, ""),
          entry: (body.entry as string[]) ?? ["/"],
          repoRoot: (body.repoRoot as string) || undefined,
          appDir: (body.appDir as string) || undefined,
          tsconfig: (body.tsconfig as string) || undefined,
          sources: (body.sources as string[]) ?? undefined,
          auth: (body.auth as Project["auth"]) ?? { strategy: "none" },
        });
        // Secrets are set through the same form but stored separately, never listed back.
        if (body.email || body.password) setSecrets(id, { email: body.email, password: body.password });
        return sendJson(res, 200, { id: project.id });
      } catch (e) {
        return sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    const projDelete = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (projDelete && req.method === "DELETE") {
      return sendJson(res, deleteProject(projDelete[1]) ? 200 : 404, { ok: true });
    }

    // ---- Pipeline stages + persisted jobs (P2) ----
    const stageMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/stages\/([a-z]+)$/);
    if (stageMatch && req.method === "POST") {
      const project = getProject(stageMatch[1]);
      if (!project) return sendJson(res, 404, { error: "no such project" });
      const stage = stageMatch[2] as StageName;
      if (!["scan", "discover", "prioritize", "run", "report", "visual", "respec"].includes(stage))
        return sendJson(res, 400, { error: `unknown stage ${stage}` });
      const busy = projectBusy(project.id);
      if (busy) return sendJson(res, 409, { error: `stage ${busy.stage} already running (job ${busy.id})` });
      // Spend gate (lazy-dist preflightBlocked pattern): no stage starts past the cap.
      const gate = preflightBlocked(project.id);
      if (gate.blocked) return sendJson(res, 402, { error: `monthly cost cap reached ($${gate.spentUsd.toFixed(2)} of $${gate.capUsd}) - raise the budget on the admin page` });
      const job = newJob(project.id, stage);
      void runCaptured(
        async () => {
          job.status = "running";
          persistJob(job);
          try {
            const { summary } = await runStage(project, stage);
            job.summary = summary;
            job.status = "done";
          } catch (e) {
            job.status = "error";
            job.error = e instanceof Error ? e.message : String(e);
            appendLog(job, `[error] ${job.error}`);
          } finally {
            job.endedAt = new Date().toISOString();
            persistJob(job);
          }
        },
        (line) => appendLog(job, line)
      );
      return sendJson(res, 200, { jobId: job.id });
    }

    const jobsList = url.pathname.match(/^\/api\/projects\/([^/]+)\/jobs$/);
    if (jobsList && req.method === "GET") {
      return sendJson(res, 200, listJobs(jobsList[1]).map((j) => ({ ...j, log: undefined })));
    }

    const jobEvents = url.pathname.match(/^\/api\/projects\/([^/]+)\/jobs\/([^/]+)\/events$/);
    if (jobEvents && req.method === "GET") {
      const job = getJob(jobEvents[1], jobEvents[2]);
      if (!job) return sendJson(res, 404, { error: "no such job" });
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      let sent = 0;
      const tick = () => {
        while (sent < job.log.length) res.write(`data: ${JSON.stringify({ line: job.log[sent++] })}\n\n`);
        if (job.status !== "running" && job.status !== "queued") {
          res.write(`data: ${JSON.stringify({ status: job.status, summary: job.summary, error: job.error })}\n\n`);
          res.end();
          clearInterval(interval);
        }
      };
      const interval = setInterval(tick, 700);
      tick();
      req.on("close", () => clearInterval(interval));
      return;
    }

    // ---- Admin: usage, budgets, pricing (SaaS metering) ----
    if (url.pathname === "/api/admin/usage" && req.method === "GET") {
      const month = url.searchParams.get("month") ?? undefined;
      return sendJson(res, 200, {
        months: listMonths(),
        summary: summarize(month ?? undefined),
        budgets: getBudgets(),
        defaultCapUsd: DEFAULT_MONTHLY_CAP_USD,
        projects: publicProjects().map((p) => ({ id: p.id, name: p.name })),
      });
    }
    if (url.pathname === "/api/admin/budget" && req.method === "POST") {
      const body = JSON.parse(await readBody(req)) as { projectId: string; monthlyCapUsd: number };
      if (!body.projectId || typeof body.monthlyCapUsd !== "number") return sendJson(res, 400, { error: "projectId + monthlyCapUsd required" });
      return sendJson(res, 200, setBudget(body.projectId, body.monthlyCapUsd));
    }
    if (url.pathname === "/api/admin/pricing" && req.method === "GET") {
      return sendJson(res, 200, { tiers: TIERS, unitEconomics: UNIT_ECONOMICS });
    }

    // ---- Understand: vision + respec (P3) ----
    const visionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/vision$/);
    if (visionMatch) {
      const project = getProject(visionMatch[1]);
      if (!project) return sendJson(res, 404, { error: "no such project" });
      if (req.method === "GET") return sendJson(res, 200, { text: getVision(project) });
      if (req.method === "PUT") {
        const body = JSON.parse(await readBody(req)) as { text?: string };
        setVision(project, body.text ?? "");
        return sendJson(res, 200, { ok: true });
      }
    }
    const respecMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/respec$/);
    if (respecMatch && req.method === "GET") {
      const project = getProject(respecMatch[1]);
      if (!project) return sendJson(res, 404, { error: "no such project" });
      return sendJson(res, 200, { respec: getRespec(project) ?? null });
    }
    const annotateMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/respec\/annotate$/);
    if (annotateMatch && req.method === "POST") {
      const project = getProject(annotateMatch[1]);
      if (!project) return sendJson(res, 404, { error: "no such project" });
      const body = JSON.parse(await readBody(req)) as { key: string; note: string };
      const respecDir = join(process.cwd(), "data", "projects", project.id, "respec");
      return sendJson(res, 200, saveAnnotation(respecDir, body.key, body.note));
    }

    // ---- Preflight (P7) ----
    const preflightMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/preflight$/);
    if (preflightMatch && req.method === "GET") {
      const project = getProject(preflightMatch[1]);
      if (!project) return sendJson(res, 404, { error: "no such project" });
      return sendJson(res, 200, await preflight(project));
    }

    // ---- Demo studio (P4-P6) ----
    if (url.pathname === "/api/studio/meta" && req.method === "GET") {
      return sendJson(res, 200, { audiences: AUDIENCES, frames: FRAMES });
    }
    const studioMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/studio$/);
    if (studioMatch && req.method === "GET") {
      const project = getProject(studioMatch[1]);
      if (!project) return sendJson(res, 404, { error: "no such project" });
      return sendJson(res, 200, getStudio(project));
    }
    const studioScript = url.pathname.match(/^\/api\/projects\/([^/]+)\/studio\/script$/);
    if (studioScript && req.method === "PUT") {
      const project = getProject(studioScript[1]);
      if (!project) return sendJson(res, 404, { error: "no such project" });
      const body = JSON.parse(await readBody(req)) as { text?: string };
      saveScript(project, body.text ?? "");
      return sendJson(res, 200, { ok: true });
    }
    const studioCompile = url.pathname.match(/^\/api\/projects\/([^/]+)\/studio\/compile$/);
    if (studioCompile && req.method === "POST") {
      const project = getProject(studioCompile[1]);
      if (!project) return sendJson(res, 404, { error: "no such project" });
      try {
        const body = JSON.parse(await readBody(req)) as { audience?: string; frame?: string; title?: string; language?: string };
        const studio = getStudio(project);
        if (!studio.script.trim()) return sendJson(res, 400, { error: "write a script first" });
        const result = await compileScript({
          scriptText: studio.script,
          projectId: project.id,
          baseUrl: project.baseUrl,
          title: body.title,
          audience: body.audience,
          frame: body.frame,
          language: body.language,
          graph: loadGraphForProject(discoveryDir(project)),
          respec: getRespec(project),
          signInPath: project.auth.signInPath,
        });
        // Carry voice defaults from the previous spec if any.
        if (studio.spec?.voice) result.spec.voice = studio.spec.voice;
        saveCompiled(project, result.spec, result.narration, result.gaps);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    // Script doors (spec 13.6): one-liner or role -> grounded draft script.
    const draftMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/studio\/draft-script$/);
    if (draftMatch && req.method === "POST") {
      const project = getProject(draftMatch[1]);
      if (!project) return sendJson(res, 404, { error: "no such project" });
      try {
        const body = JSON.parse(await readBody(req)) as { oneLiner?: string; role?: string; audience?: string };
        if (!body.oneLiner && !body.role) return sendJson(res, 400, { error: "oneLiner or role required" });
        const script = await draftScript({
          oneLiner: body.oneLiner,
          role: body.role,
          audience: body.audience,
          vision: getVision(project),
          respec: getRespec(project),
          graph: loadGraphForProject(discoveryDir(project)),
        });
        saveScript(project, script);
        return sendJson(res, 200, { script });
      } catch (e) {
        return sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    // Roles for role-first viewing (spec 13.4): respec personas.
    const rolesMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/roles$/);
    if (rolesMatch && req.method === "GET") {
      const project = getProject(rolesMatch[1]);
      if (!project) return sendJson(res, 404, { error: "no such project" });
      return sendJson(res, 200, { roles: getRespec(project)?.personas ?? [] });
    }
    // Artifact registry (spec 13.8).
    const regMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/registry$/);
    if (regMatch && req.method === "GET") {
      const project = getProject(regMatch[1]);
      if (!project) return sendJson(res, 404, { error: "no such project" });
      return sendJson(res, 200, listRegistry(project));
    }

    const studioNarr = url.pathname.match(/^\/api\/projects\/([^/]+)\/studio\/narration$/);
    if (studioNarr && req.method === "PUT") {
      const project = getProject(studioNarr[1]);
      if (!project) return sendJson(res, 404, { error: "no such project" });
      saveNarration(project, JSON.parse(await readBody(req)) as NarrationDoc);
      return sendJson(res, 200, { ok: true });
    }
    const studioSpec = url.pathname.match(/^\/api\/projects\/([^/]+)\/studio\/spec$/);
    if (studioSpec && req.method === "PUT") {
      const project = getProject(studioSpec[1]);
      if (!project) return sendJson(res, 404, { error: "no such project" });
      saveSpec(project, JSON.parse(await readBody(req)) as DemoSpec2);
      return sendJson(res, 200, { ok: true });
    }
    const studioRender = url.pathname.match(/^\/api\/projects\/([^/]+)\/studio\/render$/);
    if (studioRender && req.method === "POST") {
      const project = getProject(studioRender[1]);
      if (!project) return sendJson(res, 404, { error: "no such project" });
      const body = JSON.parse(await readBody(req)) as { draft?: boolean };
      const studio = getStudio(project);
      if (!studio.spec || !studio.narration) return sendJson(res, 400, { error: "compile a script first" });
      const busy = projectBusy(project.id);
      if (busy) return sendJson(res, 409, { error: `stage ${busy.stage} already running` });
      const gate = preflightBlocked(project.id);
      if (gate.blocked) return sendJson(res, 402, { error: `monthly cost cap reached ($${gate.spentUsd.toFixed(2)} of $${gate.capUsd}) - raise the budget on the admin page` });
      const job: StageJob = newJob(project.id, body.draft ? "render-draft" : "render-final");
      const spec = studio.spec, narration = studio.narration;
      void runCaptured(
        async () => {
          job.status = "running";
          persistJob(job);
          setUsageContext(project.id);
          try {
            const out = join(studioDir(project), "videos", `${body.draft ? "draft" : "final"}-${Date.now().toString(36)}.mp4`);
            const result = await renderSpec({
              spec,
              narration,
              respec: getRespec(project),
              outMp4: out,
              auth: authConfig(project) as never,
              dataDir: discoveryDir(project),
              draft: body.draft,
              onProgress: (l) => appendLog(job, l),
            });
            const summary: Record<string, unknown> = { video: result.videoPath, segments: result.segments, skipped: result.skipped };
            // Meter render minutes off the finished video's real duration.
            const mins = Math.max(0.5, (await probeDuration(result.videoPath).catch(() => 60)) / 60);
            recordCost("render", `render:${job.id}`, Number(mins.toFixed(2)), { projectId: project.id });
            // Artifact registry (spec 13.8): versioned + described; duplicate-flagged.
            const relPath = result.videoPath.split(`/projects/${project.id}/`)[1] ?? result.videoPath;
            const reg = registerArtifact(project, {
              name: (spec.title || "demo").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40),
              title: spec.title + (body.draft ? " (draft)" : ""),
              description: `${body.draft ? "Silent draft" : "Final render"} · audience ${spec.audience ?? "-"} · ${spec.scenes.length} scenes (${spec.scenes.map((s) => s.type).join(", ")}) · ${mins.toFixed(1)} min`,
              kind: "video",
              rel: relPath,
              inputsHash: specHash({ spec, narration }),
            });
            summary.artifact = reg.entry.id;
            if (reg.duplicateOf) appendLog(job, `[registry] note: identical inputs already rendered as ${reg.duplicateOf.id} - this render duplicates it`);
            job.summary = summary;
            job.status = "done";
          } catch (e) {
            job.status = "error";
            job.error = e instanceof Error ? e.message : String(e);
            appendLog(job, `[error] ${job.error}`);
          } finally {
            job.endedAt = new Date().toISOString();
            persistJob(job);
          }
        },
        (line) => appendLog(job, line)
      );
      return sendJson(res, 200, { jobId: job.id });
    }

    // ---- Review gate, report, triage, artifacts (P2) ----
    const pathsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/paths$/);
    if (pathsMatch && req.method === "GET") {
      const project = getProject(pathsMatch[1]);
      if (!project) return sendJson(res, 404, { error: "no such project" });
      return sendJson(res, 200, getPaths(project));
    }
    const reviewMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/paths\/review$/);
    if (reviewMatch && req.method === "POST") {
      const project = getProject(reviewMatch[1]);
      if (!project) return sendJson(res, 404, { error: "no such project" });
      const body = JSON.parse(await readBody(req)) as { approve?: string[]; reject?: string[]; edits?: { id: string; goal: string }[] };
      return sendJson(res, 200, reviewPaths(project, body));
    }
    const reportMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/report$/);
    if (reportMatch && req.method === "GET") {
      const project = getProject(reportMatch[1]);
      if (!project) return sendJson(res, 404, { error: "no such project" });
      return sendJson(res, 200, { report: getReport(project) ?? null });
    }
    const triageGet = url.pathname.match(/^\/api\/projects\/([^/]+)\/triage$/);
    if (triageGet && req.method === "GET") {
      const project = getProject(triageGet[1]);
      if (!project) return sendJson(res, 404, { error: "no such project" });
      return sendJson(res, 200, getTriage(project));
    }
    if (triageGet && req.method === "POST") {
      const project = getProject(triageGet[1]);
      if (!project) return sendJson(res, 404, { error: "no such project" });
      const body = JSON.parse(await readBody(req)) as { issueId: string; verdict: "confirmed" | "false-positive" | "env" };
      if (!body.issueId || !["confirmed", "false-positive", "env"].includes(body.verdict))
        return sendJson(res, 400, { error: "issueId + verdict (confirmed|false-positive|env) required" });
      return sendJson(res, 200, setTriage(project, body.issueId, body.verdict));
    }
    const artifactsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/artifacts$/);
    if (artifactsMatch && req.method === "GET") {
      const project = getProject(artifactsMatch[1]);
      if (!project) return sendJson(res, 404, { error: "no such project" });
      return sendJson(res, 200, listArtifacts(project));
    }
    const fileMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/file$/);
    if (fileMatch && req.method === "GET") {
      const project = getProject(fileMatch[1]);
      const rel = url.searchParams.get("path") ?? "";
      const full = project && artifactPath(project, rel);
      if (!full) return sendJson(res, 404, { error: "no such artifact" });
      const type = full.endsWith(".mp4") ? "video/mp4" : full.endsWith(".html") ? "text/html; charset=utf-8" : full.endsWith(".json") ? "application/json" : "text/plain; charset=utf-8";
      const stat = statSync(full);
      const range = req.headers.range;
      if (range && type === "video/mp4") {
        const start = parseInt(range.replace(/bytes=/, "").split("-")[0], 10) || 0;
        const endRaw = parseInt((range.match(/-(\d+)/) ?? [])[1], 10);
        const end = isNaN(endRaw) || endRaw >= stat.size ? stat.size - 1 : endRaw;
        res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
        createReadStream(full, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { "Content-Type": type, "Content-Length": stat.size });
        createReadStream(full).pipe(res);
      }
      return;
    }

    // Start a run
    if (url.pathname === "/api/run" && req.method === "POST") {
      try {
        const config = JSON.parse(await readBody(req)) as Record<string, unknown>;
        if (!config.outPath) return sendJson(res, 400, { error: "outPath is required" });
        const job: RunJob = { id: newId(), status: "running", log: [], consentWaiters: [] };
        jobs.set(job.id, job);
        void startRun(job, config);
        return sendJson(res, 200, { id: job.id });
      } catch (e) {
        return sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    }

    // SSE events stream for a run
    const evtMatch = url.pathname.match(/^\/api\/run\/([^/]+)\/events$/);
    if (evtMatch && req.method === "GET") {
      const job = jobs.get(evtMatch[1]);
      if (!job) return sendJson(res, 404, { error: "no such run" });
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      let interval: ReturnType<typeof setInterval> | undefined;
      const push = () => {
        const payload: Record<string, unknown> = { status: job.status, line: job.log[job.log.length - 1] ?? "" };
        if (job.status === "done") payload.status = "done";
        if (job.consentPrompt) payload.consentPrompt = job.consentPrompt;
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
        if (job.status !== "running") {
          res.end();
          if (interval) clearInterval(interval);
        }
      };
      // Replay history then poll for new state.
      for (const line of job.log) res.write(`data: ${JSON.stringify({ line })}\n\n`);
      if (job.consentPrompt) res.write(`data: ${JSON.stringify({ consentPrompt: job.consentPrompt })}\n\n`);
      if (job.status !== "running") push();
      if (job.status === "running") interval = setInterval(push, 1000);
      req.on("close", () => clearInterval(interval));
      return;
    }

    // Answer consent for a run
    const consentMatch = url.pathname.match(/^\/api\/run\/([^/]+)\/consent$/);
    if (consentMatch && req.method === "POST") {
      const job = jobs.get(consentMatch[1]);
      if (!job) return sendJson(res, 404, { error: "no such run" });
      const body = JSON.parse(await readBody(req)) as { allow?: boolean };
      job.consentPrompt = undefined;
      const waiters = job.consentWaiters.splice(0);
      for (const w of waiters) w.resolve(Boolean(body.allow));
      return sendJson(res, 200, { ok: true });
    }

    // Stop a run (web "stop" button) - releases cursor lock + stops capture.
    const stopMatch = url.pathname.match(/^\/api\/run\/([^/]+)\/stop$/);
    if (stopMatch && req.method === "POST") {
      const job = jobs.get(stopMatch[1]);
      if (!job) return sendJson(res, 404, { error: "no such run" });
      job.stopRequested = true;
      job.log.push("[stop] stop requested - saving what we have...");
      return sendJson(res, 200, { ok: true });
    }

    // Serve the finished video (with basic Range support so <video> seeking works)
    const videoMatch = url.pathname.match(/^\/api\/run\/([^/]+)\/video$/);
    if (videoMatch && req.method === "GET") {
      const job = jobs.get(videoMatch[1]);
      if (!job?.videoPath || !existsSync(job.videoPath)) return sendJson(res, 404, { error: "no video yet" });
      const stat = statSync(job.videoPath);
      const total = stat.size;
      const range = req.headers.range;
      const start = range ? parseInt(range.replace(/bytes=/, "").split("-")[0], 10) || 0 : 0;
      const end = range ? parseInt((range.match(/-(\d+)/) ?? [])[1], 10) : total - 1;
      const safeEnd = isNaN(end) || end >= total ? total - 1 : end;
      if (range) {
        res.writeHead(206, {
          "Content-Type": "video/mp4",
          "Content-Range": `bytes ${start}-${safeEnd}/${total}`,
          "Accept-Ranges": "bytes",
          "Content-Length": safeEnd - start + 1,
        });
        const stream = createReadStream(job.videoPath, { start, end: safeEnd });
        stream.pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Type": "video/mp4",
          "Content-Length": total,
          "Accept-Ranges": "bytes",
        });
        res.end(readFileSync(job.videoPath));
      }
      return;
    }

    sendJson(res, 404, { error: "not found" });
  });

  const port = opts.port ?? 7788;
  server.listen(port, () => {
    console.log(`prodlens web app -> http://localhost:${port}`);
  });

  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
