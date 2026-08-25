// Spec: v2 §13.10 (runner protocol v1) - see spec/traceability.md
// ProdLens runner agent (spec 13.10, runner protocol v1): polls the cloud
// control plane for jobs, executes them with the local engine, streams logs,
// uploads artifacts to Blob, and reports completion. One codebase for both
// the self-hosted runner (this) and the cloud runner pool (same agent in a
// container).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { upload } from "@vercel/blob/client";
import { saveProject, setSecrets, projectRoot, type Project } from "../web/registry.js";
import { runStage, reviewPaths, getPaths, discoveryDir, authConfig, getRespec, getVision } from "../web/pipeline.js";
import { runCaptured } from "../web/jobs.js";
import { draftScript, compileScript, loadGraphForProject } from "../studio/compile.js";
import { saveScript, saveCompiled, studioDir } from "../studio/store.js";
import { renderSpec, type RenderResult } from "../studio/render.js";

interface CloudJob {
  id: string;
  orgId: string;
  kind: "discover" | "full" | "respec" | "video";
  target: {
    name: string; baseUrl: string; entry?: string[]; authStrategy?: string;
    tokenInLocalStorage?: boolean; email?: string; password?: string; sources?: string[];
    signInPath?: string; loginButton?: string;
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
      auth: {
        strategy: (job.target.authStrategy as Project["auth"]["strategy"]) ?? "none",
        tokenInLocalStorage: job.target.tokenInLocalStorage,
        signInPath: job.target.signInPath,
        loginButton: job.target.loginButton,
      },
      sources: job.target.sources,
    });
    if (job.target.email || job.target.password) setSecrets(projectId, { email: job.target.email, password: job.target.password });

    const summary: Record<string, unknown> = {};
    const stage = async (name: Parameters<typeof runStage>[1]) => {
      buf.push(`[stage] ${name} starting`);
      const r = await runStage(project, name);
      Object.assign(summary, r.summary);
      buf.push(`[stage] ${name} done: ${JSON.stringify(r.summary).slice(0, 200)}`);
    };
    let videoResult: RenderResult | undefined;
    await runCaptured(async () => {
      if (job.kind === "discover" || job.kind === "full") await stage("discover");
      if (job.kind === "respec") await stage("respec");
      if (job.kind === "full") {
        await stage("prioritize");
        // Cloud jobs are headless - auto-approve (the review gate lives in the dashboard for interactive runs).
        const approved = getPaths(project).map((p) => p.id);
        reviewPaths(project, { approve: approved });
        buf.push(`[stage] review auto-approved ${approved.length} journey(s) (headless job)`);
        await stage("run");
        await stage("report");
      }
      if (job.kind === "video") {
        // Video jobs carry no prior local studio work (unlike the dashboard
        // flow, which requires a hand-written/approved script) - discover
        // first to ground screen paths, respec best-effort for diagram
        // scenes. Without these, compileScript either accepts hallucinated
        // goto targets (no grounded screen list) or drops every beat as
        // unsatisfiable (no LLM configured) - see src/studio/compile.ts.
        await stage("discover");
        try { await stage("respec"); } catch (e) { buf.push(`[video] respec skipped: ${e instanceof Error ? e.message : e}`); }
        const graph = loadGraphForProject(discoveryDir(project));
        const respec = getRespec(project);
        buf.push("[video] drafting script");
        const scriptText = await draftScript({ graph, respec, vision: getVision(project) });
        saveScript(project, scriptText);
        buf.push("[video] compiling script into scenes");
        const { spec, narration, gaps } = await compileScript({
          scriptText, projectId: project.id, baseUrl: project.baseUrl,
          graph, respec, signInPath: project.auth.signInPath,
        });
        saveCompiled(project, spec, narration, gaps);
        summary.gaps = gaps.length;
        if (!spec.scenes.length)
          throw new Error(`nothing to render - script produced 0 satisfiable scenes (${gaps.length} gap(s): ${gaps.map((g) => g.reason).slice(0, 3).join("; ")})`);
        // Draft only: a "final" (narrated, TTS) render is the product's HITL
        // review-gate output (spec section 6, "every stage emits a
        // reviewable draft" - never a batch) - an unattended cloud API call
        // shouldn't skip that gate and publish a finished video unreviewed.
        const outMp4 = join(studioDir(project), "videos", `draft-${Date.now().toString(36)}.mp4`);
        buf.push(`[video] rendering ${spec.scenes.length} scene(s)`);
        videoResult = await renderSpec({
          spec, narration, respec, outMp4,
          auth: authConfig(project) as never,
          dataDir: discoveryDir(project),
          draft: true,
          onProgress: (l) => buf.push(l),
        });
        summary.video = videoResult.videoPath;
        summary.segments = videoResult.segments;
        summary.skipped = videoResult.skipped;
      }
    }, (line) => buf.push(line));

    // Upload artifacts.
    const artifacts: Array<{ name: string; url: string }> = [];
    const up = async (label: string, filePath: string, type: string) => {
      const res = await upload(`artifacts/${job.id}/${label}`, readFileSync(filePath), {
        access: "public", handleUploadUrl: `${cloud}/api/runner/upload`, clientPayload: token, contentType: type,
      });
      artifacts.push({ name: label, url: res.url });
    };
    if (job.kind === "video" && videoResult) {
      await up("video.mp4", videoResult.videoPath, "video/mp4").catch((e) => buf.push(`[runner] video upload failed: ${e.message}`));
      if (existsSync(videoResult.choreographyPath)) await up("choreography.json", videoResult.choreographyPath, "application/json").catch(() => {});
    } else {
      // discover/full/respec: newest report md + verification report json.
      const dd = discoveryDir({ id: projectId } as Project);
      const reportsDir = join(dd, "reports");
      if (existsSync(reportsDir)) {
        const newest = readdirSync(reportsDir).map((f) => join(reportsDir, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
        if (newest) await up("report.md", newest, "text/markdown").catch((e) => buf.push(`[runner] report upload failed: ${e.message}`));
      }
      const vr = join(projectRoot(projectId), "discovery", "verification-report.json");
      if (existsSync(vr)) await up("verification-report.json", vr, "application/json").catch(() => {});
    }

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
