#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { runStaticPass } from "./discovery/static/index.js";
import { runLiveCrawl } from "./discovery/crawler.js";
import { analyzeGraph, buildVerificationReport } from "./graph/analysis.js";
import { saveGraph, loadGraph, mergeGraphs, remapGraphToPatterns, createVersion, saveVersion, diff } from "./graph/graph-store.js";
import { renderMarkdownReport, renderVerificationMarkdown, writeReport } from "./reporting/reporter.js";
import { renderExplorerHtml, writeExplorer } from "./reporting/explorer.js";
import { collectProjectArtifacts } from "./reporting/projects.js";
import { runVisualTriage, visualReportToIssues } from "./visual/triage.js";
import type { VisualReport } from "./visual/triage.js";
import { createRunDir } from "./run/version.js";
import { synthesize } from "./prioritization/synthesize.js";
import { reviewPathsInteractive } from "./prioritization/review.js";
import { appendTraceFeedback, loadLatestGuidance, runGepaReflection } from "./prioritization/gepa.js";
import { runExecution } from "./execution/executor.js";
import { runExplore } from "./agent/explore.js";
import { deriveRunSummary, deriveFeedback } from "./runlog/derive.js";
import { loadRunLog } from "./runlog/store.js";
import { capturePathToVideo, screenshotsToVideo, recordDesktopScreen } from "./execution/capture.js";
import { renderExplainer } from "./execution/explain.js";
import { renderProductDemo, synthesizeDemoScript } from "./execution/demo.js";
import { runWalkthrough } from "./adapters/walkthrough.js";
import { buildSurface } from "./adapters/surface.js";
import { synthesizeAdapter } from "./adapters/synthesis.js";
import { startWebServer } from "./web/server.js";
import type { Graph, GraphVersion, InputScenario, PrioritizedPath, PathRunResult } from "./types.js";

const program = new Command();
program
  .name("prodlens")
  .description("Looks at a whole web product through one lens: recovers the UI as a graph of screens and transitions, verifies every edge, plans and runs the critical user journeys, and turns the same walkthrough into a narrated demo with a real cursor.");

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8"));
}

/** Strip the extension from an output path (keeping the trailing dot), so
 *  companion artifacts (<out>.silent.mp4, <out>.screenplay.json) can be
 *  derived from it. */
function replaceExtForScript(path: string): string {
  return path.replace(/\.[a-zA-Z0-9]+$/, "") + ".";
}

/** Accepts either a raw graph.json (Graph) or an already-versioned GraphVersion
 *  json and normalizes to GraphVersion, so downstream commands don't care
 *  which upstream command produced the file. */
function loadAsIntendedVersion(path: string): GraphVersion {
  const raw = readJson<Graph | GraphVersion>(path);
  if ("id" in raw && "type" in raw && "createdAt" in raw) return raw as GraphVersion;
  return createVersion("intended", raw as Graph);
}

function loadScenarios(outDir: string): InputScenario[] {
  try {
    return readJson<InputScenario[]>(join(outDir, "scenarios.json"));
  } catch {
    return [];
  }
}

function findPngs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f: string) => f.toLowerCase().endsWith(".png"))
    .sort()
    .map((f: string) => join(dir, f));
}

/** If a path lives inside data/projects/<app>/, return that per-project root -
 *  the repo's canonical artifact home (.gitignore). Lets commands default
 *  their outputs into the project folder instead of ./data. Undefined for
 *  graphs that aren't project-scoped. */
function projectRootForPath(path: string): string | undefined {
  const abs = resolve(path);
  const m = abs.match(/^(.*[\\/])data[\\/]projects[\\/][^\\/]+/);
  return m?.[0];
}

program
  .command("scan")
  .description("Static pass only: parse the app's source for routes and navigation/button wiring. No browser, no server needed.")
  .requiredOption("--app-dir <path>", "path to the Next.js app directory (e.g. <repo>/src/app)")
  .option("--src-root <path>", "root to scan for interactions, defaults to the parent of --app-dir")
  .option("--tsconfig <path>", "tsconfig.json for the target app, improves type resolution")
  .option("--name <name>", "app name for the report title", "app")
  .option("--out <dir>", "output directory for graph.json and the report", "./data")
  .action((opts) => {
    const appDir = resolve(opts.appDir);
    const srcRoot = resolve(opts.srcRoot ?? join(appDir, ".."));
    const { graph } = runStaticPass({ appDir, srcRoot, tsConfigFilePath: opts.tsconfig ? resolve(opts.tsconfig) : undefined });
    const analysis = analyzeGraph(graph);

    const outDir = resolve(opts.out);
    saveGraph(graph, join(outDir, "graph.json"));
    const markdown = renderMarkdownReport(graph, analysis, opts.name);
    const reportPath = join(outDir, "reports", `scan-${Date.now()}.md`);
    writeReport(markdown, reportPath);

    console.log(markdown);
    console.log(`\nGraph written to ${join(outDir, "graph.json")}`);
    console.log(`Report written to ${reportPath}`);

    const hasCriticalFindings = analysis.deadStaticElements.length > 0 || analysis.brokenEdges.length > 0;
    if (hasCriticalFindings) process.exitCode = 1;
  });

program
  .command("discover")
  .description("Live crawl with Playwright: visits real pages, clicks real elements, records what actually happens")
  .requiredOption("--base-url <url>", "e.g. http://localhost:3100")
  .option("--entry <paths...>", "entry paths to start from", ["/"])
  .option("--max-pages <n>", "max pages to visit", "40")
  .option("--max-depth <n>", "max BFS depth", "4")
  .option("--auth <strategy>", "none | password | clerk-password | clerk-signup | custom-login", "none")
  .option("--auth-token-in-localstorage", "with --auth custom-login: the app stores its auth token in localStorage (e.g. access_token)", false)
  .option("--out <dir>", "output directory", "./data")
  .option("--merge-with <path>", "merge this discover run into an existing graph.json from 'scan'")
  .action(async (opts) => {
    const outDir = resolve(opts.out);
    const { graph } = await runLiveCrawl({
      baseUrl: opts.baseUrl,
      entryPaths: opts.entry,
      maxPages: Number(opts.maxPages),
      maxDepth: Number(opts.maxDepth),
      screenshotDir: join(outDir, "screenshots"),
      auth: {
        strategy: opts.auth,
        baseUrl: opts.baseUrl,
        protectedPath: opts.entry[0],
        email: process.env.UX_FLOW_TEST_EMAIL,
        password: process.env.UX_FLOW_TEST_PASSWORD,
        localStorageToken: opts.authTokenInLocalstorage,
        storageStatePath: join(outDir, "storage-state", "session.json"),
      },
    });

    let finalGraph = graph;
    if (opts.mergeWith) {
      const staticGraph = loadGraph(resolve(opts.mergeWith));
      const patterns = Object.keys(staticGraph.nodes);
      const remappedLive = remapGraphToPatterns(graph, patterns);
      finalGraph = mergeGraphs(staticGraph, remappedLive);
    }
    const analysis = analyzeGraph(finalGraph);
    saveGraph(finalGraph, join(outDir, "graph.json"));
    const markdown = renderMarkdownReport(finalGraph, analysis, "live crawl");
    const reportPath = join(outDir, "reports", `discover-${Date.now()}.md`);
    writeReport(markdown, reportPath);
    console.log(markdown);
    console.log(`\nGraph written to ${join(outDir, "graph.json")}`);
    console.log(`Report written to ${reportPath}`);
  });

program
  .command("agent-explore")
  .description("Agent-driven discovery: an LLM agent explores the live app screen by screen behind the guard chain, logging every decision/tool call to an append-only run log and deriving the graph from it")
  .requiredOption("--base-url <url>", "e.g. http://localhost:3100")
  .option("--entry <paths...>", "entry paths to start exploration from", ["/"])
  .option("--max-steps <n>", "max agent steps per episode", "15")
  .option("--max-episodes <n>", "max episodes (frontier pops)", "10")
  .option("--auth <strategy>", "none | password | clerk-password | clerk-signup | custom-login", "none")
  .option("--auth-token-in-localstorage", "with --auth custom-login: the app stores its auth token in localStorage (e.g. access_token)", false)
  .option("--out <dir>", "output directory", "./data")
  .option("--merge-with <path>", "merge this explore graph into an existing graph.json from 'scan'")
  .action(async (opts) => {
    const outDir = resolve(opts.out);
    const result = await runExplore({
      baseUrl: opts.baseUrl,
      entryPaths: opts.entry,
      outDir,
      maxSteps: Number(opts.maxSteps),
      maxEpisodes: Number(opts.maxEpisodes),
      auth: {
        strategy: opts.auth,
        baseUrl: opts.baseUrl,
        protectedPath: opts.entry[0],
        email: process.env.UX_FLOW_TEST_EMAIL,
        password: process.env.UX_FLOW_TEST_PASSWORD,
        localStorageToken: opts.authTokenInLocalstorage,
        storageStatePath: join(outDir, "storage-state", "session.json"),
      },
    });

    let finalGraph = loadGraph(result.graphPath);
    if (opts.mergeWith) {
      const staticGraph = loadGraph(resolve(opts.mergeWith));
      const patterns = Object.keys(staticGraph.nodes);
      const remappedLive = remapGraphToPatterns(finalGraph, patterns);
      finalGraph = mergeGraphs(staticGraph, remappedLive);
      saveGraph(finalGraph, join(outDir, "graph.json"));
    }
    const analysis = analyzeGraph(finalGraph);
    const markdown = renderMarkdownReport(finalGraph, analysis, "agent explore");
    const reportPath = join(outDir, "reports", `explore-${Date.now()}.md`);
    writeReport(markdown, reportPath);

    const summary = deriveRunSummary(loadRunLog(result.logPath));
    console.log(
      `Explore complete: ${result.nodes} nodes, ${result.edges} edges across ${result.episodes} episodes (${result.failedEpisodes} failed).`
    );
    console.log(`Run log written to ${result.logPath} (${summary.episodes.length} episodes, ${loadRunLog(result.logPath).length} events)`);
    console.log(`Graph written to ${join(outDir, "graph.json")}`);
    console.log(`Report written to ${reportPath}`);
  });

program
  .command("prioritize")
  .description("Synthesis Engine: infer personas + prioritized journeys grounded in a recovered graph (LLM if configured, heuristic fallback otherwise)")
  .requiredOption("--graph <path>", "graph.json from 'scan' or 'discover' (or a saved GraphVersion)")
  .option("--out <dir>", "output directory", "./data")
  .option("--max-personas <n>", "max personas to infer", "3")
  .option("--max-journeys <n>", "max journeys per persona", "2")
  .option("--no-gepa", "don't apply guidance.json from a previous 'gepa' run, even if present")
  .action(async (opts) => {
    const outDir = resolve(opts.out);
    const intended = loadAsIntendedVersion(resolve(opts.graph));
    const gepaGuidance = opts.gepa === false ? undefined : loadLatestGuidance(outDir)?.guidance;

    // synthesize() may ground InputScenarios onto intended.edges (mutating
    // them in place) - run it before saving the version so the persisted
    // GraphVersion carries the same inputScenarioId links the executor needs.
    const { personas, paths, scenarios } = await synthesize(intended, {
      maxPersonas: Number(opts.maxPersonas),
      maxJourneysPerPersona: Number(opts.maxJourneys),
      gepaGuidance,
    });
    const versionPath = saveVersion(intended, outDir);

    writeJson(join(outDir, "personas.json"), personas);
    writeJson(join(outDir, "paths.json"), paths);
    writeJson(join(outDir, "scenarios.json"), scenarios);

    console.log(`Intended graph version saved to ${versionPath}`);
    console.log(`${personas.length} persona(s), ${paths.length} prioritized path(s) written to ${outDir}`);
    if (!paths.length) console.log("No plannable journeys found - the graph may be too small, or every candidate target was unreachable.");
    for (const p of paths) console.log(`  [${p.priority}] ${p.goal} (${p.steps.length} step(s)) - ${p.reason}`);
  });

program
  .command("review")
  .description("Manual review gate: approve/reject/edit each path's goal between 'prioritize' and 'run'. Interactive; use --approve/--reject/--approve-all for scripted use.")
  .requiredOption("--paths <path>", "paths.json from 'prioritize'")
  .option("--approve <ids...>", "approve these path ids non-interactively (repeatable)")
  .option("--reject <ids...>", "reject (skip) these path ids non-interactively")
  .option("--approve-all", "approve every still-planned path non-interactively")
  .action(async (opts) => {
    const pathsFile = resolve(opts.paths);
    const paths = readJson<PrioritizedPath[]>(pathsFile);

    if (opts.approve || opts.reject || opts.approveAll) {
      const approveIds = new Set<string>(opts.approve ?? []);
      const rejectIds = new Set<string>(opts.reject ?? []);
      for (const p of paths) {
        if (approveIds.has(p.id) || opts.approveAll) p.status = "approved";
        else if (rejectIds.has(p.id)) p.status = "skipped";
      }
    } else {
      await reviewPathsInteractive(paths);
    }

    writeJson(pathsFile, paths);
    for (const p of paths) console.log(`  [${p.status}] ${p.goal}`);
    const stillPlanned = paths.filter((p) => p.status === "planned").length;
    if (stillPlanned) console.log(`${stillPlanned} path(s) still "planned" - re-run 'review' to decide on them before 'run'.`);
  });

program
  .command("run")
  .description("Execution Engine: run approved PrioritizedPath[] against the live app (parallel workers), recording the actual graph")
  .requiredOption("--paths <path>", "paths.json from 'prioritize' (and, ideally, 'review')")
  .requiredOption("--graph <path>", "the intended GraphVersion saved by 'prioritize' (versions/<id>.json)")
  .requiredOption("--base-url <url>", "e.g. http://localhost:3100")
  .option("--auth <strategy>", "none | password | clerk-password | clerk-signup | custom-login", "none")
  .option("--auth-token-in-localstorage", "with --auth custom-login: the app stores its auth token in localStorage (e.g. access_token)", false)
  .option("--out <dir>", "output directory", "./data")
  .option("--concurrency <n>", "concurrent path workers", "4")
  .option("--skip-review", "run every path regardless of review status, instead of only 'approved' ones")
  .option("--no-agent-fallback", "disable the LLM agent fallback for steps whose selector/label can't be resolved")
  .action(async (opts) => {
    const outDir = resolve(opts.out);
    const intended = loadAsIntendedVersion(resolve(opts.graph));
    const paths = readJson<PrioritizedPath[]>(resolve(opts.paths));
    const scenarios = loadScenarios(outDir);

    const stillPlanned = paths.filter((p) => p.status === "planned");
    if (stillPlanned.length && !opts.skipReview) {
      console.error(`${stillPlanned.length} path(s) still "planned" - run 'review' first, or pass --skip-review to run everything as-is.`);
      process.exitCode = 1;
      return;
    }
    const toRun = opts.skipReview ? paths : paths.filter((p) => p.status === "approved");
    if (!toRun.length) {
      console.log("No approved paths to run.");
      return;
    }
    for (const p of toRun) p.status = "running";

    const { nodes, edges, results } = await runExecution(toRun, intended, scenarios, {
      baseUrl: opts.baseUrl,
      screenshotDir: join(outDir, "screenshots", "run"),
      concurrency: Number(opts.concurrency),
      agentFallback: opts.agentFallback,
      logPath: join(outDir, "log.jsonl"),
      auth: {
        strategy: opts.auth,
        baseUrl: opts.baseUrl,
        protectedPath: intended.entryPoints[0],
        email: process.env.UX_FLOW_TEST_EMAIL,
        password: process.env.UX_FLOW_TEST_PASSWORD,
        localStorageToken: opts.authTokenInLocalstorage,
        storageStatePath: join(outDir, "storage-state", "session.json"),
      },
    });

    const actual = createVersion("actual", { nodes, edges, entryPoints: intended.entryPoints }, { parentVersionId: intended.id });
    const actualPath = saveVersion(actual, outDir);
    writeJson(join(outDir, "path-results.json"), results);
    writeJson(join(outDir, "paths.json"), paths); // steps/status now updated, including any not run this time

    console.log(`Actual graph version saved to ${actualPath}`);
    for (const r of results) console.log(`  [${r.status}] ${r.goal} (${r.stepsCompleted}/${r.stepsTotal} steps)${r.error ? ` - ${r.error}` : ""}`);

    if (results.some((r) => r.status !== "passed")) process.exitCode = 1;
  });

program
  .command("report")
  .description("Analysis Engine: diff intended vs actual graphs, produce the verification report")
  .requiredOption("--intended <path>", "intended GraphVersion (versions/<id>.json from 'prioritize')")
  .requiredOption("--actual <path>", "actual GraphVersion (versions/<id>.json from 'run')")
  .requiredOption("--results <path>", "path-results.json from 'run'")
  .option("--name <name>", "app name for the report title", "app")
  .option("--out <dir>", "output directory (default: a new runs/v0.<n>/ folder under the data/projects/<app>/ containing --intended, else ./data)")
  .option("--visual <path>", "optional VisualReport JSON from the 'visual' command - folds visual findings into the report's issue list")
  .option("--runlog <path>", "optional run log to fold GEPA feedback from the agent loop into (default: <out>/log.jsonl when present)")
  .action((opts) => {
    const intendedPath = resolve(opts.intended);
    const projectRoot = projectRootForPath(intendedPath);
    const outDir = resolve(opts.out ?? (projectRoot ? createRunDir(projectRoot) : "./data"));
    const intended = readJson<GraphVersion>(intendedPath);
    const actual = readJson<GraphVersion>(resolve(opts.actual));
    const results = readJson<PathRunResult[]>(resolve(opts.results));

    const graphDiff = diff(intended, actual);
    const { report, feedback } = buildVerificationReport(intended, actual, graphDiff, results);
    if (opts.visual) report.issues.push(...visualReportToIssues(readJson<VisualReport>(resolve(opts.visual))));
    // Run-log-derived feedback also feeds the GEPA loop. When the report is
    // produced from an auto-versioned run folder the log lives at <out>/log.jsonl;
    // an explicit --runlog overrides that.
    const runlogPath = opts.runlog
      ? resolve(opts.runlog)
      : existsSync(join(outDir, "log.jsonl"))
        ? join(outDir, "log.jsonl")
        : undefined;
    const derived = runlogPath ? deriveFeedback(loadRunLog(runlogPath)) : [];
    // traces.json accumulates across runs for the 'gepa' reflection loop - when
    // the out dir is an auto-versioned run folder, keep it at the stable
    // project root instead; an explicit --out stays fully self-contained.
    appendTraceFeedback([...feedback, ...derived], opts.out ? outDir : projectRoot ?? "./data");

    writeJson(join(outDir, "verification-report.json"), report);
    const markdown = renderVerificationMarkdown(report, opts.name);
    const reportPath = join(outDir, "reports", `verify-${Date.now()}.md`);
    writeReport(markdown, reportPath);

    console.log(markdown);
    console.log(`\nReport written to ${reportPath}`);
    if (report.issues.some((i) => i.severity === "critical")) process.exitCode = 1;
  });

program
  .command("explore")
  .description("Interactive graph/path explorer + a Projects tab that surfaces the run's reports/specs/artifacts/videos in-tool (writes a self-contained HTML file)")
  .requiredOption("--graph <path>", "graph.json or a GraphVersion")
  .option("--paths <path>", "paths.json from 'prioritize', to show alongside the graph")
  .option("--results <path>", "path-results.json from 'run', to show pass/fail on top of paths")
  .option("--name <name>", "app name for the page title", "app")
  .option("--out <dir>", "output directory", "./data")
  .option("--project <dir>", "a project out-dir (e.g. the app's ./data/flow-report) whose reports/specs/artifacts/videos appear under a Projects tab")
  .option("--spec-dir <dir>", "directory of spec/docs files to surface under Projects (e.g. <app>/spec, <app>/docs)")
  .option("--web-assets <dir>", "copy videos/images into this dir and reference them by served relative path (for deploying the explorer to a static host like Vercel)")
  .action((opts) => {
    const outDir = resolve(opts.out);
    const graph = loadAsIntendedVersion(resolve(opts.graph));
    const analysis = analyzeGraph(graph);
    const paths = opts.paths ? readJson<PrioritizedPath[]>(resolve(opts.paths)) : undefined;
    const results = opts.results ? readJson<PathRunResult[]>(resolve(opts.results)) : undefined;

    const html = renderExplorerHtml({
      graph,
      analysis,
      paths,
      results,
      appName: opts.name,
      project: opts.project
        ? collectProjectArtifacts(resolve(opts.project), {
            specDirs: opts.specDir ? [resolve(opts.specDir)] : [],
            webAssetsDir: opts.webAssets ? resolve(opts.webAssets) : undefined,
          })
        : undefined,
    });
    const outPath = join(outDir, "explorer.html");
    writeExplorer(html, outPath);
    console.log(`Explorer written to ${outPath} - open it directly in a browser.`);
  });

program
  .command("visual")
  .description("Visual QA pass: a vision-capable LLM (e.g. qwen-vl via an OpenAI-compatible endpoint) looks at each discovered screen's screenshot and flags rendering problems - empty or blank screens, endless spinners, clipped layouts, visually-dead buttons. Pure batched inference over existing screenshots (no browser), so it just needs the screenshots a discover/run already captured and the endpoint reachable.")
  .requiredOption("--graph <path>", "graph.json or a GraphVersion; the screenshots are each node's screenshotPath")
  .option("--out <dir>", "output directory (default: a new runs/v0.<n>/ folder under the data/projects/<app>/ containing --graph, else ./data)")
  .option("--screenshots <dir>", "directory of per-node screenshots to use (reconstructed as <sanitized-node-id>.png) when the graph's recorded screenshotPath is stale or absent")
  .option("--concurrency <n>", "parallel vision requests against the endpoint (it queues anyway; keep low)", "1")
  .option("--model <name>", "vision model id on the endpoint (default from LLM_VISION_MODEL, e.g. qwen-vl-max)")
  .action(async (opts) => {
    const graphPath = resolve(opts.graph);
    const projectRoot = projectRootForPath(graphPath);
    const outDir = resolve(opts.out ?? (projectRoot ? createRunDir(projectRoot) : "./data"));
    const graph = loadAsIntendedVersion(graphPath);
    const report = await runVisualTriage(graph, {
      screenshotsDir: opts.screenshots ? resolve(opts.screenshots) : undefined,
      concurrency: Number(opts.concurrency),
      model: opts.model,
    });
    const outPath = join(outDir, "visual", `${graph.id}.json`);
    writeJson(outPath, report);

    for (const s of report.shots.filter((s) => s.finding && s.finding.severity !== "ok"))
      console.log(`  [${s.finding!.severity}] ${s.nodeId} - ${s.finding!.evidence}`);
    for (const s of report.shots.filter((s) => s.error)) console.log(`  [error] ${s.nodeId}: ${s.error}`);

    console.log(`Visual QA: ${report.shots.length} screenshot(s), ${report.flagged} flagged (of ${Object.keys(graph.nodes).length} nodes). Written to ${outPath}`);
    console.log('Fold these into a verification report with: report ... --visual <that file>');
    if (report.shots.some((s) => s.finding?.severity === "critical")) process.exitCode = 1;
  });

program
  .command("capture")
  .description("Replay one prioritized journey in a real browser and record it as a .webm video (one video per path)")
  .requiredOption("--paths <path>", "paths.json from 'prioritize' (or 'run' - statuses are ignored, every path is captured)")
  .requiredOption("--graph <path>", "the intended GraphVersion saved by 'prioritize' (versions/<id>.json)")
  .requiredOption("--base-url <url>", "e.g. http://localhost:3100")
  .option("--auth <strategy>", "none | password | clerk-password | clerk-signup | custom-login", "none")
  .option("--auth-token-in-localstorage", "with --auth custom-login: the app stores its auth token in localStorage (e.g. access_token)", false)
  .option("--out <dir>", "output directory", "./data")
  .option("--path <id>", "only capture this path id; omit for every path in --paths")
  .action(async (opts) => {
    const outDir = resolve(opts.out);
    const intended = loadAsIntendedVersion(resolve(opts.graph));
    const allPaths = readJson<PrioritizedPath[]>(resolve(opts.paths));
    const toCapture = opts.path ? allPaths.filter((p) => p.id === opts.path) : allPaths;
    if (!toCapture.length) {
      console.log(`No paths to capture${opts.path ? ` (id "${opts.path}" not found)` : ""}.`);
      return;
    }
    const scenarios = loadScenarios(outDir);
    const auth = {
      strategy: opts.auth,
      baseUrl: opts.baseUrl,
      protectedPath: intended.entryPoints[0],
      email: process.env.UX_FLOW_TEST_EMAIL,
      password: process.env.UX_FLOW_TEST_PASSWORD,
      localStorageToken: opts.authTokenInLocalstorage,
      storageStatePath: join(outDir, "storage-state", "session.json"),
    };

    for (const p of toCapture) {
      console.log(`Recording [${p.id}] ${p.goal}...`);
      try {
        const res = await capturePathToVideo(p, intended, scenarios, {
          baseUrl: opts.baseUrl,
          auth,
          videosDir: join(outDir, "videos"),
          screenshotsDir: join(outDir, "screenshots", "capture"),
        });
        console.log(`  [${res.status}] ${res.pathId} -> ${res.videoPath ?? "no video"}${res.error ? ` - ${res.error}` : ""}`);
      } catch (e) {
        console.log(`  [failed] ${p.goal} - ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  });

program
  .command("screens-to-video")
  .description("Assemble existing per-step screenshots (e.g. data/screenshots/run/*.png) into an MP4 with ffmpeg - no browser needed")
  .requiredOption("--dir <path>", "directory of PNG screenshots to assemble (all *.png, sorted by name)")
  .requiredOption("--out <path>", "output video path, e.g. ./data/videos/run.mp4")
  .option("--framerate <n>", "frames per second (each screenshot holds 1/n s)", "1")
  .option("--scale <v>", "ffmpeg scale filter", "1280:-2")
  .action(async (opts) => {
    const pngs = findPngs(resolve(opts.dir));
    if (!pngs.length) {
      console.log("No .png files found in the directory.");
      return;
    }
    const outPath = resolve(opts.out);
    const written = await screenshotsToVideo(pngs, outPath, {
      frameRate: Number(opts.framerate),
      scale: opts.scale,
    });
    console.log(`Assembled ${pngs.length} screenshot(s) into ${written}`);
  });

program
  .command("record-screen")
  .description("Record the mac screen (AVFoundation) to an MP4 - capture yourself driving the explorer, reports, or the app. Requires ffmpeg.")
  .requiredOption("--out <path>", "output file path, e.g. ./data/videos/explorer-drive.mp4")
  .option("--device <n>", "AVFoundation screen index (list: ffmpeg -f avfoundation -list_devices true -i \"\")", "2")
  .option("--duration <ms>", "how long to record for", "30000")
  .option("--framerate <n>", "capture fps", "12")
  .action(async (opts) => {
    console.log(`Recording screen (device ${opts.device}) for ${opts.duration}ms to ${opts.out} - switch to the window you want to capture.`);
    const written = await recordDesktopScreen(resolve(opts.out), {
      deviceIndex: Number(opts.device),
      durationMs: Number(opts.duration),
      framerate: Number(opts.framerate),
    });
    console.log(`Recorded -> ${written}`);
  });

program
  .command("demo")
  .description("Record a narrated click-through demo: drive the real app in a headed browser (also capturable as one live video), scroll each screen through, then mix per-step TTS narration onto the recorded timeline (Gemini, local Kokoro, or --tts-cmd; see explain). Emits a voiced MP4 plus a silent twin + timestamped screenplay (what to say and when) for voice-over re-recording. Guided mode (script.guided) lets a vision-capable LLM pick each step from the live screenshot; auto-narrate (script.autoNarrate) writes lines for steps without one. --auth clerk-signup creates a fresh test account on the fly.")
  .option("--script <path>", "demo JSON: { baseUrl, valueProp?, intro?, entry?, steps: [{ name, narrate?, goto?, fill?, click?, selector?, scroll?, settleMs? }] }")
  .requiredOption("--out <path>", "output MP4 path, e.g. ./data/videos/demo/easydist.mp4")
  .option("--base-url <url>", "overrides baseUrl from the script")
  .option("--auth <strategy>", "none | password | clerk-password | clerk-signup | custom-login", "none")
  .option("--auth-token-in-localstorage", "with --auth custom-login: the app stores its auth token in localStorage (e.g. access_token)", false)
  .option("--data-dir <path>", "directory holding storage-state/session.json, defaults to the parent of the output video's folder", "./data")
  .option("--voice <name>", "Gemini neural voice", "Kore")
  .option("--scale <filter>", "output resolution filter, e.g. 1280:-2", "1280:-2")
  .option("--no-voice", "skip the voiced render - emit silent video + screenplay only")
  .option("--no-captions", "don't burn narration captions into the video")
  .option("--os-cursor", "drive the REAL OS cursor (cliclick) and record the screen - the pointer in the video is the actual OS cursor. The browser window must stay frontmost during recording.", false)
  .option("--tts-cmd <cmd>", "optional AI TTS shell command; receives TTS_TEXT/TTS_OUT/TTS_VOICE env and must write audio to $TTS_OUT")
  .option("--from-graph <path>", "synthesize the demo script draft from a discovered graph (graph.json or GraphVersion)")
  .option("--from-paths <path>", "only synthesize from these prioritized paths.json (with --from-graph)")
  .option("--value-prop <text>", "one-line value prop used for the intro card + screenplay header (with --from-graph)")
  .action(async (opts) => {
    const outPath = resolve(opts.out);
    if (!opts.script && !opts.fromGraph) {
      console.error("Specify --script <path> (an existing demo script) or --from-graph <path> (synthesize a draft from a discovered graph).");
      process.exitCode = 1;
      return;
    }

    let script: import("./execution/demo.js").DemoScript;
    if (opts.fromGraph) {
      const graph = loadAsIntendedVersion(resolve(opts.fromGraph));
      const paths = opts.fromPaths ? readJson<import("./types.js").PrioritizedPath[]>(resolve(opts.fromPaths)) : [];
      script = synthesizeDemoScript(graph, paths, opts.valueProp);
      if (opts.baseUrl) script.baseUrl = opts.baseUrl;
      const draftPath = `${replaceExtForScript(outPath)}draft.json`;
      writeJson(draftPath, script);
      console.log(`Demo script draft written to ${draftPath} - edit it, then re-run with --script to refine.`);
    } else {
      script = readJson<import("./execution/demo.js").DemoScript>(resolve(opts.script));
      if (opts.baseUrl) script.baseUrl = opts.baseUrl;
    }

    const auth = {
      strategy: opts.auth,
      baseUrl: script.baseUrl,
      protectedPath: script.entry ?? "/",
      // For clerk-signup, leave email/password unset so a fresh test account
      // is generated (+clerk_test convention); for other strategies, use the
      // configured test credentials.
      email: opts.auth === "clerk-signup" ? undefined : process.env.UX_FLOW_TEST_EMAIL,
      password: opts.auth === "clerk-signup" ? undefined : process.env.UX_FLOW_TEST_PASSWORD,
      localStorageToken: opts.authTokenInLocalstorage,
      storageStatePath: join(resolve(opts.dataDir), "storage-state", "session.json"),
    };
    const result = await renderProductDemo(script, outPath, {
      auth,
      screenshotsDir: join(dirname(outPath), "screenshots"),
      scale: opts.scale,
      voice: opts.voice,
      noVoice: opts.noVoice,
      noCaptions: opts.noCaptions,
      osCursor: opts.osCursor,
      ttsCmd: opts.ttsCmd,
    });
    console.log(`Demo written -> ${result.videoPath} (${result.stepsRun} steps, ${result.narratedClips} narrated clips)${result.error ? ` - ${result.error}` : ""}`);
    if (result.silentVideoPath) console.log(`Silent twin -> ${result.silentVideoPath}`);
    if (result.screenplayMdPath) console.log(`Screenplay -> ${result.screenplayMdPath}`);
  });

program
  .command("walkthrough")
  .description("Product-agnostic LLM-drafted walkthrough: build a surface from discovery/docs/source, pick an adapter, have an LLM draft the manifest + scenes, review (edit narration, toggle scenes, resource checklist), then execute and render a narrated video. Adapters keep prodlens product-agnostic - a product's 'what it does' lives in its adapter + manifest, not in core.")
  .requiredOption("--out <path>", "output MP4 path")
  .option("--data-dir <dir>", "discovery output dir (graph.json / versions/) for the product surface")
  .option("--repo-root <path>", "product source/repo root (for architecture + resource resolution)")
  .option("--docs <dirs...>", "doc dirs/files to include in the surface")
  .option("--description <text>", "one-line product description")
  .option("--base-url <url>", "product base URL (overrides the drafted manifest)")
  .option("--adapter <id-or-path>", "force a specific adapter: a registered id (e.g. web) or a path to an external adapter module (e.g. /path/to/product-adapter.mjs)")
  .option("--model <name>", "LLM for drafting (default qwen/qwen3-32b, overridable via LLM_MANIFEST_MODEL)")
  .option("--modes <modes...>", "force plan modes, e.g. ux flow architecture")
  .option("--skip-review", "skip the interactive review form - render the draft as-is")
  .option("--auth <strategy>", "none | password | clerk-password | clerk-signup | custom-login", "none")
  .option("--auth-token-in-localstorage", "with --auth custom-login: the app stores its auth token in localStorage (e.g. access_token)", false)
  .option("--os-cursor", "drive the REAL OS cursor (cliclick) and record the screen - the pointer in the video is the actual OS cursor. The browser window must stay frontmost during recording.", false)
  .option("--synthesize", "if no adapter matches (or to force), have the LLM generate a product adapter from --repo-root on the fly", false)
  .action(async (opts) => {
    const outPath = resolve(opts.out);
    const result = await runWalkthrough(outPath, {
      dataDir: opts.dataDir,
      repoRoot: opts.repoRoot,
      docDirs: opts.docs,
      description: opts.description,
      baseUrl: opts.baseUrl,
      adapter: opts.adapter,
      model: opts.model,
      modes: opts.modes,
      skipReview: opts.skipReview,
      osCursor: opts.osCursor,
      synthesize: opts.synthesize,
      auth: {
        strategy: opts.auth,
        email: process.env.UX_FLOW_TEST_EMAIL,
        password: process.env.UX_FLOW_TEST_PASSWORD,
        storageStatePath: opts.dataDir ? join(resolve(opts.dataDir), "storage-state", "session.json") : undefined,
        localStorageToken: opts.authTokenInLocalstorage,
      },
    });
    console.log(`Walkthrough: ${result.plan.scenes.length} scene(s), modes ${result.plan.mode.join(", ")}`);
    if (result.videoPath) console.log(`Video -> ${result.videoPath}`);
    if (result.manifest) console.log(`Manifest -> ${outPath.replace(/\.mp4$/, "")}.manifest.json`);
  });

program
  .command("adapter")
  .description("Adapter synthesis: read a product's repo and have the LLM generate a ProdlensAdapter module on the fly (the SDK is coded for the product, not shipped per-product). Writes <repo>/prodlens/adapter.mjs; validates by importing it.")
  .requiredOption("--repo-root <path>", "product source/repo root to read")
  .option("--out <dir>", "where to write adapter.mjs (default <repo-root>/prodlens)", "<repo-root>/prodlens")
  .option("--model <name>", "LLM for synthesis (default qwen/qwen3-32b, overridable via LLM_MANIFEST_MODEL)")
  .action(async (opts) => {
    const repoRoot = resolve(opts.repoRoot);
    const surface = buildSurface({ repoRoot });
    if (!surface.fileContents?.length) {
      console.warn("No key files read from the repo - synthesis may lack context.");
    }
    const outDir = opts.out === "<repo-root>/prodlens" ? join(repoRoot, "prodlens") : resolve(opts.out);
    const result = await synthesizeAdapter(surface, { outDir, model: opts.model });
    console.log(`Adapter written: ${result.path}`);
    console.log(`id: ${result.id} | name: ${result.name}`);
    console.log(`Use it: prodlens walkthrough --adapter ${result.path} ...`);
  });

program
  .command("web")
  .description("Start the prodlens web app: run LLM-drafted product walkthroughs from a browser (configure repo/description/auth, watch progress, consent to screen capture, watch the resulting video).")
  .option("-p, --port <n>", "port to listen on", "7788")
  .action(async (opts) => {
    const { startWebServer } = await import("./web/server.js");
    const server = startWebServer({ port: Number(opts.port) });
    console.log(`\n  Open: http://localhost:${server.port}\n`);
    // Keep the process alive.
    await new Promise(() => {});
  });

program
  .command("explain")
  .description("Build a narrated product-explainer MP4 from a screenplay JSON: per-scene screenshot + narration line become one video with TTS voiceover. Requires ffmpeg + ffprobe; narration uses Gemini 2.5 Flash TTS (neural, ~$0.02/video), local Kokoro-82M (free, no key), macOS 'say', or --tts-cmd - in that fallback order (TTS_BACKEND pins one).")
  .requiredOption("--script <path>", "screenplay JSON: { scene: [{ png, narrate?, holdAfter? }] }")
  .requiredOption("--out <path>", "output MP4 path, e.g. ./data/videos/explainer.mp4")
  .option("--voice <name>", "Gemini neural voice ('Kore', 'Puck', 'Charon', ...) or macOS say voice (no API key)", "Kore")
  .option("--rate <wpm>", "narration speed in words per minute", "180")
  .option("--scale <filter>", "output resolution filter, e.g. 1280:-2", "1280:-2")
  .option("--tts-cmd <cmd>", "optional AI TTS shell command; receives TTS_TEXT/TTS_OUT env and must write audio to $TTS_OUT")
  .action(async (opts) => {
    const written = await renderExplainer(resolve(opts.script), resolve(opts.out), {
      voice: opts.voice,
      rate: Number(opts.rate),
      scale: opts.scale,
      ttsCmd: opts.ttsCmd,
    });
    console.log(`Explainer written -> ${written}`);
  });

program
  .command("runner")
  .description("Connect this machine to the ProdLens cloud as a runner: polls for jobs, executes them locally (your credentials and network stay here), streams logs + uploads artifacts.")
  .requiredOption("--token <token>", "runner token from the cloud dashboard (Enroll runner)")
  .option("--cloud <url>", "control plane URL", "https://prodlens-cloud.vercel.app")
  .option("--once", "claim and run at most one job, then exit (CI mode)", false)
  .option("--poll <ms>", "poll interval", "5000")
  .action(async (opts) => {
    const { runAgent } = await import("./runner/agent.js");
    await runAgent({ cloudUrl: opts.cloud, token: opts.token, once: opts.once, pollMs: Number(opts.poll) });
  });

program
  .command("gepa")
  .description("GEPA offline reflection: distills accumulated TraceFeedback (from 'report' runs) into guidance the next 'prioritize' run applies")
  .option("--out <dir>", "output directory (where traces.json lives)", "./data")
  .action(async (opts) => {
    const outDir = resolve(opts.out);
    const guidance = await runGepaReflection(outDir);
    console.log(`Guidance v${guidance.version} written to ${join(outDir, "gepa", "guidance.json")} (based on ${guidance.basedOnTraceCount} trace(s)):`);
    console.log(guidance.guidance);
  });

program
  .command("full")
  .description("discover + prioritize + run + report in one shot")
  .requiredOption("--base-url <url>", "e.g. http://localhost:3100")
  .option("--entry <paths...>", "entry paths to start from", ["/"])
  .option("--max-pages <n>", "max pages to visit", "40")
  .option("--max-depth <n>", "max BFS depth", "4")
  .option("--auth <strategy>", "none | password | clerk-password | clerk-signup | custom-login", "none")
  .option("--auth-token-in-localstorage", "with --auth custom-login: the app stores its auth token in localStorage (e.g. access_token)", false)
  .option("--name <name>", "app name for the report title", "app")
  .option("--out <dir>", "output directory", "./data")
  .option("--concurrency <n>", "concurrent path workers", "4")
  .action(async (opts) => {
    const outDir = resolve(opts.out);
    const auth = {
      strategy: opts.auth,
      baseUrl: opts.baseUrl,
      protectedPath: opts.entry[0],
      email: process.env.UX_FLOW_TEST_EMAIL,
      password: process.env.UX_FLOW_TEST_PASSWORD,
      localStorageToken: opts.authTokenInLocalstorage,
      storageStatePath: join(outDir, "storage-state", "session.json"),
    };

    console.log("== discover ==");
    const { graph } = await runLiveCrawl({
      baseUrl: opts.baseUrl,
      entryPaths: opts.entry,
      maxPages: Number(opts.maxPages),
      maxDepth: Number(opts.maxDepth),
      screenshotDir: join(outDir, "screenshots"),
      auth,
    });
    saveGraph(graph, join(outDir, "graph.json"));
    const intended = createVersion("intended", graph);

    console.log("== prioritize ==");
    const gepaGuidance = loadLatestGuidance(outDir)?.guidance;
    const { personas, paths, scenarios } = await synthesize(intended, { gepaGuidance });
    const intendedPath = saveVersion(intended, outDir); // after synthesize: carries any grounded inputScenarioIds
    console.log(`Discovered ${Object.keys(graph.nodes).length} node(s), ${graph.edges.length} edge(s). Intended version: ${intendedPath}`);
    writeJson(join(outDir, "personas.json"), personas);
    writeJson(join(outDir, "scenarios.json"), scenarios);
    console.log(`${personas.length} persona(s), ${paths.length} prioritized path(s).`);
    if (!paths.length) {
      console.log("No plannable journeys - nothing to execute. Stopping before run/report.");
      writeJson(join(outDir, "paths.json"), paths);
      return;
    }

    // 'full' is the one-shot convenience command - no human in the loop, so
    // it auto-approves every path instead of going through the manual
    // review gate ('prioritize' -> 'review' -> 'run' is the path for that).
    for (const p of paths) p.status = "approved";
    writeJson(join(outDir, "paths.json"), paths);

    console.log("== run ==");
    const { nodes, edges, results } = await runExecution(paths, intended, scenarios, {
      baseUrl: opts.baseUrl,
      screenshotDir: join(outDir, "screenshots", "run"),
      concurrency: Number(opts.concurrency),
      logPath: join(outDir, "log.jsonl"),
      auth,
    });
    const actual = createVersion("actual", { nodes, edges, entryPoints: intended.entryPoints }, { parentVersionId: intended.id });
    const actualPath = saveVersion(actual, outDir);
    writeJson(join(outDir, "path-results.json"), results);
    writeJson(join(outDir, "paths.json"), paths);
    console.log(`Actual version: ${actualPath}`);

    console.log("== report ==");
    const graphDiff = diff(intended, actual);
    const { report, feedback } = buildVerificationReport(intended, actual, graphDiff, results);
    const derived = existsSync(join(outDir, "log.jsonl")) ? deriveFeedback(loadRunLog(join(outDir, "log.jsonl"))) : [];
    appendTraceFeedback([...feedback, ...derived], outDir);
    writeJson(join(outDir, "verification-report.json"), report);
    const markdown = renderVerificationMarkdown(report, opts.name);
    const reportPath = join(outDir, "reports", `verify-${Date.now()}.md`);
    writeReport(markdown, reportPath);
    console.log(markdown);
    console.log(`\nReport written to ${reportPath}`);

    if (report.issues.some((i) => i.severity === "critical")) process.exitCode = 1;
  });

program.parse();
