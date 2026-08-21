import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { RunLog } from "../runlog/store.js";
import { deriveGraph, deriveEpisodes } from "../runlog/derive.js";
import { runEpisode } from "./loop.js";
import type { Candidate } from "./loop.js";

const PAGES: Record<string, string> = {
  "/": `<!doctype html><html><body>
    <a href="/about">About</a>
    <button>Login</button>
  </body></html>`,
  "/about": `<!doctype html><html><body>
    <a href="/">Home</a>
  </body></html>`,
};

let server: Server;
let port = 0;

test.before(async () => {
  server = createServer((req, res) => {
    const body = PAGES[req.url ?? "/"] ?? "not found";
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  port = addr.port;
});

test.after(() => {
  server?.close();
});

async function withBrowser<T>(fn: (browser: Browser, page: Page) => Promise<T>): Promise<T> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    return await fn(browser, page);
  } finally {
    await browser.close();
  }
}

test("runEpisode logs tool/call + tool/result + agent/decide and the derived graph matches known edges", async () => {
  const dir = mkdtempSync(join(tmpdir(), "prodlens-loop-"));
  const logPath = join(dir, "log.jsonl");
  const log = new RunLog({ path: logPath });
  let stepCount = 0;

  const status = await withBrowser(async (_browser, page) => {
    return runEpisode(
      log,
      page,
      "e1",
      "Discover the product",
      `http://localhost:${port}/`,
      {
        baseUrl: `http://localhost:${port}`,
        screenshotDir: join(dir, "shots"),
        maxSteps: 3,
        loopWindow: 1,
      },
      {
        deterministic: async (_p: Page, step: number, candidates: Candidate[]) => {
          if (step === 0) {
            const about = candidates.find((c) => c.label === 'Navigate to "/about"');
            return about ? { kind: "deterministic", toolName: "navigate", args: { url: about.href }, reason: "first step" } : undefined;
          }
          return undefined;
        },
        onNavigated: () => stepCount++,
      },
      () => false
    );
  });

  log.close();
  assert.equal(status, "passed");
  assert.ok(stepCount >= 1, "expected at least one navigation");

  const events = log.events;
  const types = events.map((e) => e.type);
  assert.ok(types.includes("tool/call"));
  assert.ok(types.includes("tool/result"));
  assert.ok(types.includes("agent/decide"));
  assert.ok(types.includes("state/observed"));
  assert.ok(types.includes("edge/observed"));

  const graph = deriveGraph(events);
  assert.ok(graph.nodes["/"], "root node recorded");
  assert.ok(graph.nodes["/about"], "about node recorded");
  const navEdge = graph.edges.find((e) => e.from === "/" && e.to === "/about");
  assert.ok(navEdge, "expected a / -> /about edge");
  assert.equal(navEdge!.status, "working");

  const episodes = deriveEpisodes(events);
  const ep = episodes.find((e) => e.episodeId === "e1");
  assert.ok(ep);
  assert.equal(ep!.status, "passed");

  rmSync(dir, { recursive: true, force: true });
});

test("episode ends failed when entry navigation 404s", async () => {
  const log = new RunLog();
  const status = await withBrowser(async (_browser, page) => {
    return runEpisode(log, page, "e2", "Explore", `http://localhost:${port}/missing`, {
      baseUrl: `http://localhost:${port}`,
      maxSteps: 2,
      loopWindow: 1,
    });
  });
  assert.equal(status, "failed");
  const ep = deriveEpisodes(log.events).find((e) => e.episodeId === "e2");
  assert.equal(ep!.status, "failed");
});