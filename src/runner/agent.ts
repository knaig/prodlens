// ProdLens runner agent (spec 13.10, runner protocol v1): polls the cloud
// control plane for jobs, executes them with the local engine, streams logs,
// uploads artifacts to Blob, and reports completion. One codebase for both
// the self-hosted runner (this) and the cloud runner pool (same agent in a
// container).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { upload } from "@vercel/blob/client";
import { saveProject, setSecrets, projectRoot, type Project } from "../web/registry.js";
import { runStage, reviewPaths, getPaths, discoveryDir } from "../web/pipeline.js";
import { runCaptured } from "../web/jobs.js";

interface CloudJob {
  id: string;
  orgId: string;
  kind: "discover" | "full" | "respec";
  target: {
    name: string; baseUrl: string; entry?: string[]; authStrategy?: string;
    tokenInLocalStorage?: boolean; email?: string; password?: string; sources?: string[];
  };
}

export interface AgentOptions {
  cloudUrl: string;
  token: string;
  once?: boolean;
  pollMs?: number;
}

export async function runAgent(opts: AgentOptions): Promise<void> {
  const cloud = opts.cloudUrl.replace(/\/$/, "");
  const headers = { "Content-Type": "application/json", "x-runner-token": opts.token };
  console.log(`[runner] connected to ${cloud} - polling for jobs`);
  for (;;) {
    let job: CloudJob | null = null;
    try {
      const r = await fetch(`${cloud}/api/runner/claim`, { method: "POST", headers });
      if (r.status === 401) throw new Error("runner token rejected - re-enroll from the dashboard");
      job = ((await r.json()) as { job: CloudJob | null }).job;
    } catch (e) {
      console.error(`[runner] claim failed: ${e instanceof Error ? e.message : e}`);
      if (opts.once) return;
      await sleep(Math.max(opts.pollMs ?? 5000, 15000));
      continue;
    }
    if (!job) {
      if (opts.once) { console.log("[runner] no pending jobs"); return; }
      await sleep(opts.pollMs ?? 5000);
      continue;
    }
    console.log(`[runner] claimed job ${job.id} (${job.kind}) -> ${job.target.baseUrl}`);
    await executeJob(cloud, headers, opts.token, job);
    if (opts.once) return;
  }
}

async function executeJob(cloud: string, headers: Record<string, string>, token: string, job: CloudJob): Promise<void> {
  // Log batcher: flush every 2.5s.
  let buf: string[] = [];
  const flush = async () => {
    if (!buf.length) return;
    const lines = buf.splice(0, 200);
    await fetch(`${cloud}/api/runner/jobs/${job.id}/log`, { method: "POST", headers, body: JSON.stringify({ lines }) }).catch(() => {});
  };
  const timer = setInterval(() => void flush(), 2500);

  const projectId = `cloud-${job.id}`;
  try {
    const project: Project = saveProject({
      id: projectId,
      name: job.target.name,
      baseUrl: job.target.baseUrl.replace(/\/$/, ""),
      entry: job.target.entry?.length ? job.target.entry : ["/"],
      auth: { strategy: (job.target.authStrategy as Project["auth"]["strategy"]) ?? "none", tokenInLocalStorage: job.target.tokenInLocalStorage },
      sources: job.target.sources,
    });
    if (job.target.email || job.target.password) setSecrets(projectId, { email: job.target.email, password: job.target.password });

    const summary: Record<string, unknown> = {};
    await runCaptured(async () => {
      if (job.kind === "discover" || job.kind === "full") Object.assign(summary, (await runStage(project, "discover")).summary);
      if (job.kind === "respec") Object.assign(summary, (await runStage(project, "respec")).summary);
      if (job.kind === "full") {
        Object.assign(summary, (await runStage(project, "prioritize")).summary);
        // Cloud jobs are headless - auto-approve (the review gate lives in the dashboard for interactive runs).
        reviewPaths(project, { approve: getPaths(project).map((p) => p.id) });
        Object.assign(summary, (await runStage(project, "run")).summary);
        Object.assign(summary, (await runStage(project, "report")).summary);
      }
    }, (line) => buf.push(line));

    // Upload artifacts: newest report md + verification report json.
    const artifacts: Array<{ name: string; url: string }> = [];
    const up = async (label: string, filePath: string, type: string) => {
      const res = await upload(`artifacts/${job.id}/${label}`, readFileSync(filePath), {
        access: "public", handleUploadUrl: `${cloud}/api/runner/upload`, clientPayload: token, contentType: type,
      });
      artifacts.push({ name: label, url: res.url });
    };
    const dd = discoveryDir({ id: projectId } as Project);
    const reportsDir = join(dd, "reports");
    if (existsSync(reportsDir)) {
      const newest = readdirSync(reportsDir).map((f) => join(reportsDir, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
      if (newest) await up("report.md", newest, "text/markdown").catch((e) => buf.push(`[runner] report upload failed: ${e.message}`));
    }
    const vr = join(projectRoot(projectId), "discovery", "verification-report.json");
    if (existsSync(vr)) await up("verification-report.json", vr, "application/json").catch(() => {});

    await flush();
    await fetch(`${cloud}/api/runner/jobs/${job.id}/complete`, {
      method: "POST", headers,
      body: JSON.stringify({ status: "done", summary, artifacts }),
    });
    console.log(`[runner] job ${job.id} done (${artifacts.length} artifact(s) uploaded)`);
  } catch (e) {
    buf.push(`[runner error] ${e instanceof Error ? e.message : e}`);
    await flush();
    await fetch(`${cloud}/api/runner/jobs/${job.id}/complete`, {
      method: "POST", headers,
      body: JSON.stringify({ status: "error", error: e instanceof Error ? e.message : String(e) }),
    }).catch(() => {});
    console.error(`[runner] job ${job.id} failed: ${e instanceof Error ? e.message : e}`);
  } finally {
    clearInterval(timer);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
