// Guided exploration (M2): agent-driven discovery of an app's screens. Unlike
// the blind BFS crawler, each episode is an agent deciding the most informative
// next action against a goal ("explore new areas"), behind the guard chain. A
// frontier of unvisited paths discovered during an episode seeds the next. Every
// decision, tool call, and observed edge lands in the append-only run log; the
// graph is derived from it. Writes <outDir>/log.jsonl + <outDir>/graph.json.
import { chromium } from "playwright";
import { join } from "node:path";
import { RunLog, initRunLog } from "../runlog/store.js";
import { deriveGraph } from "../runlog/derive.js";
import { saveGraph } from "../graph/graph-store.js";
import { runEpisode } from "./loop.js";
import type { AuthConfig } from "../discovery/auth.js";
import { getAuthedContext } from "../discovery/auth.js";

export interface ExploreOptions {
  baseUrl: string;
  entryPaths: string[];
  outDir: string;
  auth: AuthConfig;
  /** Max steps per episode. Default 15. */
  maxSteps?: number;
  /** Max episodes (frontier pops). Default 10. */
  maxEpisodes?: number;
  loopWindow?: number;
  dangerousLabelPattern?: RegExp;
}

export interface ExploreResult {
  graphPath: string;
  logPath: string;
  nodes: number;
  edges: number;
  episodes: number;
  failedEpisodes: number;
}

const DEFAULT_DANGEROUS = /delete|kill|archive|disconnect|remove|rotate|cancel plan|deactivate/i;

export async function runExplore(opts: ExploreOptions): Promise<ExploreResult> {
  const logPath = join(opts.outDir, "log.jsonl");
  initRunLog(logPath);
  const log = new RunLog({ path: logPath });

  const maxSteps = opts.maxSteps ?? 15;
  const maxEpisodes = opts.maxEpisodes ?? 10;
  const dangerous = opts.dangerousLabelPattern ?? DEFAULT_DANGEROUS;

  log.append("run/start", { runId: `run-${Date.now()}`, baseUrl: opts.baseUrl, mode: "explore" });

  const visited = new Set<string>();
  const frontier: string[] = [...opts.entryPaths];
  let episodeCount = 0;
  let failedEpisodes = 0;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await getAuthedContext(browser, opts.auth);
    const page = await context.newPage();
    const discovered = new Set<string>();

    while (frontier.length && episodeCount < maxEpisodes) {
      const entry = frontier.shift()!;
      if (visited.has(entry)) continue;
      visited.add(entry);
      episodeCount++;
      const episodeId = `e${episodeCount}`;
      const goal = "Explore the product: follow links to every distinct screen, find how the app is structured.";

      const status = await runEpisode(
        log,
        page,
        episodeId,
        goal,
        `${opts.baseUrl}${entry}`,
        {
          baseUrl: opts.baseUrl,
          screenshotDir: join(opts.outDir, "screenshots"),
          maxSteps,
          loopWindow: opts.loopWindow ?? 3,
          dangerousLabelPattern: dangerous,
          authed: opts.auth.strategy !== "none",
        },
        {
          onNavigated: (_before, after) => {
            if (after !== entry && !visited.has(after) && !discovered.has(after)) {
              discovered.add(after);
              frontier.push(after);
            }
          },
        },
        () => true
      );
      if (status === "failed") failedEpisodes++;
    }

    log.append("run/end", { reason: "completed" });
  } finally {
    log.close();
    await browser.close();
  }

  const graph = deriveGraph(log.events);
  const graphPath = join(opts.outDir, "graph.json");
  saveGraph(graph, graphPath);

  return {
    graphPath,
    logPath,
    nodes: Object.keys(graph.nodes).length,
    edges: graph.edges.length,
    episodes: episodeCount,
    failedEpisodes,
  };
}