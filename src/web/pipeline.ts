// Pipeline stage runners (P2): the web app's equivalents of the CLI commands,
// wired to a Project from the registry. Mirrors src/index.ts stage actions.
// Every stage works from a live URL + credentials alone - repo access is only
// needed for `scan` (UX-only projects simply don't get that stage).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { runStaticPass } from "../discovery/static/index.js";
import { runLiveCrawl } from "../discovery/crawler.js";
import { analyzeGraph, buildVerificationReport } from "../graph/analysis.js";
import { saveGraph, loadGraph, mergeGraphs, remapGraphToPatterns, createVersion, saveVersion, diff } from "../graph/graph-store.js";
import { renderMarkdownReport, renderVerificationMarkdown, writeReport } from "../reporting/reporter.js";
import { runVisualTriage, visualReportToIssues, type VisualReport } from "../visual/triage.js";
import { createRunDir } from "../run/version.js";
import { synthesize } from "../prioritization/synthesize.js";
import { appendTraceFeedback, loadLatestGuidance } from "../prioritization/gepa.js";
import { runExecution } from "../execution/executor.js";
import { deriveFeedback } from "../runlog/derive.js";
import { loadRunLog } from "../runlog/store.js";
import type { Graph, GraphVersion, InputScenario, PrioritizedPath, PathRunResult } from "../types.js";
import { buildRespec, type Respec } from "../respec/respec.js";
import { recordCost, setUsageContext } from "../usage/ledger.js";
import { projectRoot, getSecrets, type Project } from "./registry.js";
import type { StageName } from "./jobs.js";

export function discoveryDir(p: Project): string {
  return join(projectRoot(p.id), "discovery");
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function authConfig(p: Project) {
  const secrets = getSecrets(p.id);
  return {
    strategy: p.auth.strategy,
    baseUrl: p.baseUrl,
    protectedPath: p.entry[0] ?? "/",
    email: secrets.email,
    password: secrets.password,
    localStorageToken: p.auth.tokenInLocalStorage,
    signInPath: p.auth.signInPath,
    loginButton: p.auth.loginButton,
    storageStatePath: join(discoveryDir(p), "storage-state", "session.json"),
  };
}

/** Newest versions/<type>-*.json in the project's discovery dir. */
export function latestVersionPath(p: Project, type: "intended" | "actual"): string | undefined {
  const dir = join(discoveryDir(p), "versions");
  if (!existsSync(dir)) return undefined;
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(`${type}-`) && f.endsWith(".json"))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0];
}

/** Newest visual report under runs/v0.*/
export function latestVisualPath(p: Project): string | undefined {
  const runsDir = join(projectRoot(p.id), "runs");
  if (!existsSync(runsDir)) return undefined;
  const candidates: string[] = [];
  for (const v of readdirSync(runsDir)) {
    const visDir = join(runsDir, v, "visual");
    if (!existsSync(visDir)) continue;
    for (const f of readdirSync(visDir)) if (f.endsWith(".json")) candidates.push(join(visDir, f));
  }
  return candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

function loadAsIntendedVersion(path: string): GraphVersion {
  const raw = readJson<Graph | GraphVersion>(path);
  if ("id" in raw && "type" in raw && "createdAt" in raw) return raw as GraphVersion;
  return createVersion("intended", raw as Graph);
}

export interface StageResult {
  summary: Record<string, unknown>;
}

export async function runStage(p: Project, stage: StageName): Promise<StageResult> {
  const outDir = discoveryDir(p);
  mkdirSync(outDir, { recursive: true });
  setUsageContext(p.id);
  const jobRef = `${stage}:${Date.now().toString(36)}`;

  if (stage === "scan") {
    if (!p.repoRoot || !p.appDir) throw new Error("scan needs repoRoot + appDir on the project (UX-only projects skip this stage)");
    const appDir = resolve(p.appDir);
    const { graph } = runStaticPass({
      appDir,
      srcRoot: resolve(join(appDir, "..")),
      tsConfigFilePath: p.tsconfig ? resolve(p.tsconfig) : undefined,
    });
    const analysis = analyzeGraph(graph);
    saveGraph(graph, join(outDir, "static-graph.json"));
    const md = renderMarkdownReport(graph, analysis, p.name);
    const reportPath = join(outDir, "reports", `scan-${Date.now()}.md`);
    writeReport(md, reportPath);
    return { summary: { nodes: Object.keys(graph.nodes).length, edges: graph.edges.length, reportPath } };
  }

  if (stage === "discover") {
    const { graph } = await runLiveCrawl({
      baseUrl: p.baseUrl,
      entryPaths: p.entry,
      maxPages: 40,
      maxDepth: 4,
      screenshotDir: join(outDir, "screenshots"),
      auth: authConfig(p),
    });
    let finalGraph = graph;
    const staticPath = join(outDir, "static-graph.json");
    if (existsSync(staticPath)) {
      const staticGraph = loadGraph(staticPath);
      finalGraph = mergeGraphs(staticGraph, remapGraphToPatterns(graph, Object.keys(staticGraph.nodes)));
    }
    const analysis = analyzeGraph(finalGraph);
    saveGraph(finalGraph, join(outDir, "graph.json"));
    const md = renderMarkdownReport(finalGraph, analysis, p.name);
    const reportPath = join(outDir, "reports", `discover-${Date.now()}.md`);
    writeReport(md, reportPath);
    recordCost("crawl", jobRef, Object.keys(finalGraph.nodes).length + Math.ceil(finalGraph.edges.length / 10), { projectId: p.id });
    return {
      summary: {
        nodes: Object.keys(finalGraph.nodes).length,
        edges: finalGraph.edges.length,
        brokenEdges: analysis.brokenEdges.length,
        unreachable: analysis.unreachableNodes.length,
        deadEnds: analysis.deadEndNodes.length,
        reportPath,
      },
    };
  }

  if (stage === "prioritize") {
    const graphPath = join(outDir, "graph.json");
    if (!existsSync(graphPath)) throw new Error("no graph.json yet - run discover first");
    const intended = loadAsIntendedVersion(graphPath);
    const gepaGuidance = loadLatestGuidance(outDir)?.guidance;
    const { personas, paths, scenarios } = await synthesize(intended, { gepaGuidance });
    const versionPath = saveVersion(intended, outDir);
    writeJson(join(outDir, "personas.json"), personas);
    writeJson(join(outDir, "paths.json"), paths);
    writeJson(join(outDir, "scenarios.json"), scenarios);
    return { summary: { personas: personas.length, paths: paths.length, versionPath } };
  }

  if (stage === "run") {
    const intendedPath = latestVersionPath(p, "intended");
    const pathsFile = join(outDir, "paths.json");
    if (!intendedPath || !existsSync(pathsFile)) throw new Error("run needs prioritize first (intended version + paths.json)");
    const intended = readJson<GraphVersion>(intendedPath);
    const paths = readJson<PrioritizedPath[]>(pathsFile);
    const scenarios: InputScenario[] = existsSync(join(outDir, "scenarios.json")) ? readJson(join(outDir, "scenarios.json")) : [];
    const toRun = paths.filter((x) => x.status === "approved");
    if (!toRun.length) throw new Error("no approved paths - approve journeys in the review gate first");
    for (const x of toRun) x.status = "running";
    const { nodes, edges, results } = await runExecution(toRun, intended, scenarios, {
      baseUrl: p.baseUrl,
      screenshotDir: join(outDir, "screenshots", "run"),
      concurrency: 4,
      logPath: join(outDir, "log.jsonl"),
      auth: authConfig(p),
    });
    const actual = createVersion("actual", { nodes, edges, entryPoints: intended.entryPoints }, { parentVersionId: intended.id });
    saveVersion(actual, outDir);
    writeJson(join(outDir, "path-results.json"), results);
    writeJson(pathsFile, paths);
    const passed = results.filter((r) => r.status === "passed").length;
    recordCost("execute", jobRef, Math.max(1, results.reduce((n, r) => n + r.stepsTotal, 0)), { projectId: p.id });
    return { summary: { ran: results.length, passed, failed: results.length - passed } };
  }

  if (stage === "report") {
    const intendedPath = latestVersionPath(p, "intended");
    const actualPath = latestVersionPath(p, "actual");
    const resultsPath = join(outDir, "path-results.json");
    if (!intendedPath || !actualPath || !existsSync(resultsPath)) throw new Error("report needs a completed run (intended + actual versions + path-results.json)");
    const intended = readJson<GraphVersion>(intendedPath);
    const actual = readJson<GraphVersion>(actualPath);
    const results = readJson<PathRunResult[]>(resultsPath);
    const graphDiff = diff(intended, actual);
    const { report, feedback } = buildVerificationReport(intended, actual, graphDiff, results);
    const visualPath = latestVisualPath(p);
    if (visualPath) report.issues.push(...visualReportToIssues(readJson<VisualReport>(visualPath)));
    const runlog = join(outDir, "log.jsonl");
    const derived = existsSync(runlog) ? deriveFeedback(loadRunLog(runlog)) : [];
    appendTraceFeedback([...feedback, ...derived], projectRoot(p.id));
    const runDir = createRunDir(projectRoot(p.id));
    writeJson(join(runDir, "verification-report.json"), report);
    // Stable copy at the discovery root so the UI can always show "latest".
    writeJson(join(outDir, "verification-report.json"), report);
    const md = renderVerificationMarkdown(report, p.name);
    const reportPath = join(runDir, "reports", `verify-${Date.now()}.md`);
    writeReport(md, reportPath);
    const critical = report.issues.filter((i) => i.severity === "critical").length;
    return { summary: { issues: report.issues.length, critical, reportPath, visualFolded: Boolean(visualPath) } };
  }

  if (stage === "visual") {
    const intendedPath = latestVersionPath(p, "intended") ?? (existsSync(join(outDir, "graph.json")) ? join(outDir, "graph.json") : undefined);
    if (!intendedPath) throw new Error("visual needs a graph - run discover first");
    const graph = loadAsIntendedVersion(intendedPath);
    const report = await runVisualTriage(graph, { concurrency: 1 });
    const runDir = createRunDir(projectRoot(p.id));
    const outPath = join(runDir, "visual", `${graph.id}.json`);
    writeJson(outPath, report);
    return { summary: { shots: report.shots.length, flagged: report.flagged, outPath } };
  }

  if (stage === "respec") {
    const respecDir = join(projectRoot(p.id), "respec");
    const visionPath = join(projectRoot(p.id), "vision.md");
    const respec = await buildRespec(
      {
        name: p.name,
        repoRoot: p.repoRoot,
        dataDir: outDir,
        visionText: existsSync(visionPath) ? readFileSync(visionPath, "utf-8") : undefined,
      },
      respecDir
    );
    return {
      summary: {
        source: respec.source,
        components: respec.topology.length,
        capabilities: respec.capabilities.length,
        flows: respec.flows.length,
        drift: respec.drift.length,
        specPath: join(respecDir, "spec.md"),
      },
    };
  }

  throw new Error(`unknown stage: ${stage}`);
}

export function getRespec(p: Project): Respec | undefined {
  const f = join(projectRoot(p.id), "respec", "spec.json");
  return existsSync(f) ? readJson<Respec>(f) : undefined;
}

export function getVision(p: Project): string {
  const f = join(projectRoot(p.id), "vision.md");
  return existsSync(f) ? readFileSync(f, "utf-8") : "";
}

export function setVision(p: Project, text: string): void {
  writeFileSync(join(projectRoot(p.id), "vision.md"), text);
}

// ---- review gate + triage + read models for the UI ----

export function getPaths(p: Project): PrioritizedPath[] {
  const f = join(discoveryDir(p), "paths.json");
  return existsSync(f) ? readJson<PrioritizedPath[]>(f) : [];
}

export function reviewPaths(p: Project, actions: { approve?: string[]; reject?: string[]; edits?: { id: string; goal: string }[] }): PrioritizedPath[] {
  const f = join(discoveryDir(p), "paths.json");
  const paths = getPaths(p);
  const approve = new Set(actions.approve ?? []);
  const reject = new Set(actions.reject ?? []);
  const edits = new Map((actions.edits ?? []).map((e) => [e.id, e.goal]));
  for (const x of paths) {
    if (edits.has(x.id)) x.goal = edits.get(x.id)!;
    if (approve.has(x.id)) x.status = "approved";
    else if (reject.has(x.id)) x.status = "skipped";
  }
  writeJson(f, paths);
  return paths;
}

export function getReport(p: Project): unknown | undefined {
  const f = join(discoveryDir(p), "verification-report.json");
  return existsSync(f) ? readJson(f) : undefined;
}

export interface TriageVerdicts {
  [issueId: string]: { verdict: "confirmed" | "false-positive" | "env"; at: string };
}

export function getTriage(p: Project): TriageVerdicts {
  const f = join(projectRoot(p.id), "triage.json");
  return existsSync(f) ? readJson<TriageVerdicts>(f) : {};
}

export function setTriage(p: Project, issueId: string, verdict: "confirmed" | "false-positive" | "env"): TriageVerdicts {
  const all = getTriage(p);
  all[issueId] = { verdict, at: new Date().toISOString() };
  writeJson(join(projectRoot(p.id), "triage.json"), all);
  // Feed the GEPA loop: a human triage verdict is high-quality trace feedback.
  appendTraceFeedback(
    [
      {
        runId: `triage-${Date.now()}`,
        module: "diagnosis",
        score: verdict === "confirmed" ? 1 : 0,
        feedback: `Human triage marked issue ${issueId} as ${verdict}.${verdict === "false-positive" ? " Future prioritization/diagnosis should avoid producing this class of finding." : ""}`,
        traceSummary: `issue=${issueId} verdict=${verdict}`,
      },
    ],
    projectRoot(p.id)
  );
  return all;
}

/** Flat artifact listing for the UI (reports, videos, run folders). */
export function listArtifacts(p: Project): Array<{ rel: string; size: number; mtime: string }> {
  const root = projectRoot(p.id);
  const out: Array<{ rel: string; size: number; mtime: string }> = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4 || !existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "storage-state" || name === "secrets.json" || name === "jobs") continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full, depth + 1);
      else if (/\.(md|mp4|json|html)$/.test(name) && !name.startsWith(".")) {
        out.push({ rel: full.slice(root.length + 1), size: st.size, mtime: st.mtime.toISOString() });
      }
    }
  };
  walk(root, 0);
  return out.sort((a, b) => b.mtime.localeCompare(a.mtime)).slice(0, 200);
}

/** Serve-safe absolute path for a project-relative artifact (traversal-guarded). */
export function artifactPath(p: Project, rel: string): string | undefined {
  const root = projectRoot(p.id);
  const full = resolve(root, rel);
  if (!full.startsWith(resolve(root) + "/")) return undefined;
  if (full.includes("secrets.json")) return undefined;
  return existsSync(full) ? full : undefined;
}
