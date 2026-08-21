// Persisted stage jobs (P1): every pipeline run is a job saved under
// data/projects/<id>/jobs/<jobId>.json so history survives server restarts.
// Stage functions log via console.* - a global capture hook forwards those
// lines into the active job's log, and a single-flight queue keeps stage jobs
// from interleaving their console output.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./registry.js";

export type StageName = "scan" | "discover" | "prioritize" | "run" | "report" | "visual" | "respec" | "render-draft" | "render-final";

export interface StageJob {
  id: string;
  projectId: string;
  stage: StageName;
  status: "queued" | "running" | "done" | "error" | "interrupted";
  log: string[];
  startedAt: string;
  endedAt?: string;
  error?: string;
  /** Small stage-specific result summary (counts, artifact paths). */
  summary?: Record<string, unknown>;
}

const active = new Map<string, StageJob>();
const bootTime = new Date().toISOString();

function jobsDir(projectId: string): string {
  return join(projectRoot(projectId), "jobs");
}

function jobPath(job: Pick<StageJob, "projectId" | "id">): string {
  return join(jobsDir(job.projectId), `${job.id}.json`);
}

export function persistJob(job: StageJob): void {
  mkdirSync(jobsDir(job.projectId), { recursive: true });
  writeFileSync(jobPath(job), JSON.stringify(job, null, 2));
}

export function newJob(projectId: string, stage: StageName): StageJob {
  const job: StageJob = {
    id: `${stage}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    projectId,
    stage,
    status: "queued",
    log: [],
    startedAt: new Date().toISOString(),
  };
  active.set(job.id, job);
  persistJob(job);
  return job;
}

export function getJob(projectId: string, id: string): StageJob | undefined {
  const inMem = active.get(id);
  if (inMem) return inMem;
  try {
    const job = JSON.parse(readFileSync(join(jobsDir(projectId), `${id}.json`), "utf-8")) as StageJob;
    // A "running" job on disk that this process doesn't know about died with a
    // previous server - surface it honestly.
    if ((job.status === "running" || job.status === "queued") && job.startedAt < bootTime) job.status = "interrupted";
    return job;
  } catch {
    return undefined;
  }
}

export function listJobs(projectId: string): StageJob[] {
  let files: string[] = [];
  try {
    files = readdirSync(jobsDir(projectId)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return files
    .map((f) => getJob(projectId, f.replace(/\.json$/, "")))
    .filter((j): j is StageJob => Boolean(j))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function appendLog(job: StageJob, line: string): void {
  // Strip ANSI escapes + control chars: raw Playwright output otherwise makes
  // the persisted job JSON invalid for strict parsers.
  // eslint-disable-next-line no-control-regex
  job.log.push(line.replace(/\u001b\[[0-9;]*m/g, "").replace(/[\u0000-\u0008\u000b-\u001f]/g, ""));
  // Throttle disk writes: persist every 8 lines; status changes persist explicitly.
  if (job.log.length % 8 === 0) persistJob(job);
}

/** Is any stage job currently running for this project? (one at a time per project) */
export function projectBusy(projectId: string): StageJob | undefined {
  for (const j of active.values()) if (j.projectId === projectId && (j.status === "running" || j.status === "queued")) return j;
  return undefined;
}

// ---- global single-flight queue + console capture ----

let chain: Promise<void> = Promise.resolve();

/** Run `fn` with console.log/warn/error forwarded to `onLine`, serialized
 *  against all other captured stage runs (so interleaved logs can't cross
 *  jobs). Legacy walkthrough jobs don't use this and are unaffected. */
export function runCaptured(fn: () => Promise<void>, onLine: (line: string) => void): Promise<void> {
  const result = chain.then(async () => {
    const orig = { log: console.log, warn: console.warn, error: console.error };
    const fwd = (level: string) => (...args: unknown[]) => {
      const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      for (const l of line.split("\n")) if (l.trim()) onLine(level === "log" ? l : `[${level}] ${l}`);
      (orig as Record<string, (...a: unknown[]) => void>)[level](...args);
    };
    console.log = fwd("log");
    console.warn = fwd("warn");
    console.error = fwd("error");
    try {
      await fn();
    } finally {
      console.log = orig.log;
      console.warn = orig.warn;
      console.error = orig.error;
    }
  });
  chain = result.catch(() => {});
  return result;
}
