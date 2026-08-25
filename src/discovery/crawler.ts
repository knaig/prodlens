// Spec: FR-RE-1, FR-RE-2, NFR-1 - see spec/traceability.md
// Live discovery: BFS over the running app with a real browser. This is what
// resolves what the static pass can't - template-literal-built hrefs, actual
// click behavior, runtime auth redirects - because it reads the real
// rendered DOM instead of guessing from source text.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { getAuthedContext, type AuthConfig } from "./auth.js";
import { computeStateSignature } from "./state-signature.js";
import { scanForms } from "./form-scan.js";
import type { Edge, Graph, Node } from "../types.js";

export interface CrawlOptions {
  baseUrl: string;
  entryPaths: string[];
  maxPages: number;
  maxDepth: number;
  screenshotDir: string;
  auth: AuthConfig;
  clickSettleMs?: number;
  /** Buttons whose visible text matches this are skipped, never clicked -
   *  the crawler must never be the thing that deletes a real project or
   *  disconnects a real integration. Recorded as "untested", not "broken". */
  dangerousLabelPattern?: RegExp;
}

const DEFAULT_DANGEROUS_PATTERN = /delete|kill|archive|disconnect|remove|rotate|cancel plan|deactivate/i;

export interface CrawlResult {
  graph: Graph;
}

export async function runLiveCrawl(opts: CrawlOptions): Promise<CrawlResult> {
  mkdirSync(opts.screenshotDir, { recursive: true });
  const dangerousPattern = opts.dangerousLabelPattern ?? DEFAULT_DANGEROUS_PATTERN;

  const browser = await chromium.launch({ headless: true });
  const context = await getAuthedContext(browser, opts.auth);
  const page = await context.newPage();

  const nodes: Record<string, Node> = {};
  const edges: Edge[] = [];
  const visited = new Set<string>();
  const queue: { path: string; depth: number }[] = opts.entryPaths.map((p) => ({ path: p, depth: 0 }));
  let edgeCounter = 0;
  let pagesVisited = 0;

  try {
    while (queue.length && pagesVisited < opts.maxPages) {
      const next = queue.shift();
      if (!next) break;
      const { path, depth } = next;
      if (visited.has(path)) continue;
      visited.add(path);
      pagesVisited++;

      const navigated = await page.goto(`${opts.baseUrl}${path}`, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
      if (!navigated) continue;

      // Let async-rendered nav (SPA shells, client-side layouts) settle before
      // reading the DOM - some apps paint the sidebar after domcontentloaded.
      await page.waitForTimeout(900);
      // An authenticated visit to a public-looking route (e.g. "/" doubling
      // as the login page) can client-side redirect only after an auth-check
      // API call resolves - instant on a local dev server, but real network
      // latency to a deployed app can outlast the flat 900ms above, so the
      // crawler reads the pre-redirect (logged-out) markup and never
      // discovers anything past it. Bounded wait for the network to go quiet
      // covers that redirect without hanging on an app with background polling.
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => null);

      const currentUrl = page.url();
      const title = await page.title().catch(() => "");
      const nodeId = new URL(currentUrl).pathname;
      const screenshotPath = `${opts.screenshotDir}/${sanitize(nodeId)}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => null);

      const forms = await scanForms(page);

      nodes[nodeId] = {
        id: nodeId,
        url: currentUrl,
        title,
        stateSignature: computeStateSignature(currentUrl, title),
        screenshotPath,
        source: "observed",
        metadata: forms.length ? { forms } : undefined,
      };

      if (depth >= opts.maxDepth) continue;

      const hrefs = await page
        .$$eval("a[href]", (as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")).filter((h): h is string => !!h))
        .catch(() => [] as string[]);
      for (const href of new Set(hrefs)) {
        if (/^(https?:)?\/\//.test(href) && !href.startsWith(opts.baseUrl)) continue;
        if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
        const targetPath = href.startsWith("http") ? new URL(href).pathname : href.split("?")[0].split("#")[0];
        edges.push({
          id: `live-${edgeCounter++}`,
          from: nodeId,
          to: targetPath,
          action: `Navigate via link to "${href}"`,
          isReturnPath: false,
          status: "working",
          source: "observed",
        });
        if (!visited.has(targetPath)) queue.push({ path: targetPath, depth: depth + 1 });
      }

      const buttonCount = await page.locator("button:visible").count().catch(() => 0);
      for (let i = 0; i < buttonCount; i++) {
        const button = page.locator("button:visible").nth(i);
        const label = (await button.innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 60);

        if (dangerousPattern.test(label)) {
          edges.push({
            id: `live-${edgeCounter++}`,
            from: nodeId,
            to: null,
            action: `Click "${label}"`,
            isReturnPath: false,
            status: "untested",
            error: "Skipped: label matches the dangerous-action pattern - never auto-clicked.",
            source: "observed",
          });
          continue;
        }

        const before = page.url();
        let status: Edge["status"] = "working";
        let error: string | undefined;
        try {
          await button.click({ timeout: 5000 });
          await page.waitForTimeout(opts.clickSettleMs ?? 400);
        } catch (e) {
          status = "broken";
          error = e instanceof Error ? e.message : "click failed";
        }
        const after = page.url();
        const didNavigate = before !== after;
        edges.push({
          id: `live-${edgeCounter++}`,
          from: nodeId,
          to: didNavigate ? new URL(after).pathname : null,
          action: `Click "${label}"`,
          isReturnPath: false,
          status,
          error,
          source: "observed",
        });
        if (didNavigate) {
          await page.goto(currentUrl, { waitUntil: "domcontentloaded" }).catch(() => null);
        }
      }
    }
  } finally {
    await browser.close();
  }

  return { graph: { nodes, edges, entryPoints: opts.entryPaths } };
}

function sanitize(p: string): string {
  return p.replace(/[^a-zA-Z0-9]/g, "_") || "root";
}
