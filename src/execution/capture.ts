// Spec: FR-VE-3 - see spec/traceability.md
// Video capture for UX flows. Three deliverable shapes, one module:
//
// 1. capturePathToVideo - replays one PrioritizedPath in a real browser with
//    Playwright's recordVideo, saving one .webm per path. Mirrors the
//    executor's step semantics (fill any grounded input scenario, then
//    click/link each step) so the video shows the real journey.
// 2. screenshotsToVideo - assembles existing per-step PNGs from a prior run
//    (data/screenshots/run/<pathId>_<n>.png) into an MP4 with ffmpeg, no
//    browser needed.
// 3. recordDesktopScreen - raw screen capture of the developer driving
//    anything (explorer.html, reports, the app), via ffmpeg's AVFoundation
//    backend on macOS.
//
// ffmpeg must be installed for 2 and 3; 1 only needs Playwright.
import { chromium, type Page } from "playwright";
import { execFile, spawn } from "node:child_process";
import { mkdirSync, copyFileSync, rmSync } from "node:fs";
import { dirname, basename } from "node:path";
import { getAuthedContext, type AuthConfig } from "../discovery/auth.js";
import type { Edge, GraphVersion, InputScenario, PrioritizedPath } from "../types.js";

export interface CaptureOptions {
  baseUrl: string;
  auth: AuthConfig;
  videosDir: string;
  screenshotsDir: string;
  actionTimeoutMs?: number;
  settleMs?: number;
  viewport?: { width: number; height: number };
}

export interface CaptureResult {
  pathId: string;
  status: "passed" | "failed";
  stepsCompleted: number;
  stepsTotal: number;
  videoPath?: string;
  screenshotPaths: string[];
  error?: string;
}

// ----- 1. Live replay, one .webm per path -----

export async function capturePathToVideo(
  path: PrioritizedPath,
  intended: GraphVersion,
  scenarios: InputScenario[],
  opts: CaptureOptions
): Promise<CaptureResult> {
  mkdirSync(opts.videosDir, { recursive: true });
  mkdirSync(opts.screenshotsDir, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const shots: string[] = [];
  let stepsCompleted = 0;
  let error: string | undefined;
  let videoPath: string | undefined;

  try {
    const context = await getAuthedContext(browser, opts.auth, {
      recordVideo: { dir: opts.videosDir, size: opts.viewport ?? { width: 1280, height: 800 } },
    });
    const page = await context.newPage();
    if (opts.viewport) await page.setViewportSize(opts.viewport);

    const edgesById = new Map(intended.edges.map((e) => [e.id, e]));
    const scenariosById = new Map(scenarios.map((s) => [s.id, s]));
    const firstEdge = path.steps[0]?.edgeId ? edgesById.get(path.steps[0].edgeId) : undefined;
    const startNodeId = firstEdge?.from ?? intended.entryPoints[0];
    await page.goto(`${opts.baseUrl}${startNodeId}`, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
    await page.waitForTimeout(600);

    for (let i = 0; i < path.steps.length; i++) {
      const step = path.steps[i];
      const edge = step.edgeId ? edgesById.get(step.edgeId) : undefined;
      if (!edge) {
        error = `Step references unknown edgeId "${step.edgeId}"`;
        break;
      }

      if (edge.inputScenarioId) await fillFormScenario(page, scenariosById.get(edge.inputScenarioId));

      const before = page.url();
      try {
        await performEdgeAction(page, edge, opts.baseUrl, opts.actionTimeoutMs ?? 8000);
        await page.waitForTimeout(opts.settleMs ?? 400);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        await page.screenshot({ path: `${opts.screenshotsDir}/${safeName(path.id)}_${i}.png`, fullPage: false }).catch(() => null);
        break;
      }

      shots.push(`${opts.screenshotsDir}/${safeName(path.id)}_${i}.png`);
      await page.screenshot({ path: shots[shots.length - 1], fullPage: false }).catch(() => null);
      const after = page.url();
      if (before === after) {
        error = `Action "${edge.action}" ran but the page did not navigate.`;
        break;
      }
      stepsCompleted++;
    }

    await page.waitForTimeout(500);
    videoPath = await page.video()?.path();
    await context.close();
  } finally {
    await browser.close();
  }

  return {
    pathId: path.id,
    status: error || stepsCompleted < path.steps.length ? "failed" : "passed",
    stepsCompleted,
    stepsTotal: path.steps.length,
    videoPath,
    screenshotPaths: shots,
    error,
  };
}

/** Fills a detected form's fields with its InputScenario's heuristic values
 *  before the submit action runs - identical semantics to the executor's
 *  fillFormScenario so a captured video matches a real run. */
async function fillFormScenario(page: Page, scenario: InputScenario | undefined): Promise<void> {
  if (!scenario) return;
  for (const [selector, value] of Object.entries(scenario.values)) {
    const locator = page.locator(selector).first();
    if (typeof value === "boolean") {
      await (value ? locator.check({ timeout: 3000 }) : locator.uncheck({ timeout: 3000 })).catch(() => null);
      continue;
    }
    await locator.fill(String(value), { timeout: 3000 }).catch(() =>
      locator.selectOption(String(value), { timeout: 3000 }).catch(() => null)
    );
  }
}

function isHrefLike(s: string): boolean {
  return (s.startsWith("/") || s.startsWith("http")) && !/\s/.test(s);
}

/** Resolves one intended edge's action against the live page - selector first,
 *  then quoted href (navigate), then visible text (link/button/any element).
 *  Same ordering as the executor, so the recording does what the run did. */
async function performEdgeAction(page: Page, edge: Edge, baseUrl: string, timeoutMs: number): Promise<void> {
  if (edge.selector) {
    await page.locator(edge.selector).first().click({ timeout: timeoutMs });
    return;
  }
  const quoted = edge.action.match(/"([^"]*)"/)?.[1];
  if (!quoted) throw new Error(`Cannot resolve action "${edge.action}" to a DOM interaction.`);

  if (isHrefLike(quoted)) {
    const target = quoted.startsWith("http") ? new URL(quoted).pathname : quoted.split("?")[0].split("#")[0];
    const navigated = await page.goto(`${baseUrl}${target}`, { waitUntil: "domcontentloaded", timeout: timeoutMs }).catch(() => null);
    if (!navigated) throw new Error(`Navigation to "${target}" failed.`);
    return;
  }

  const byLink = page.getByRole("link", { name: quoted, exact: true }).first();
  if (await byLink.isVisible().catch(() => false)) return byLink.click({ timeout: timeoutMs });
  const byButton = page.getByRole("button", { name: quoted, exact: true }).first();
  if (await byButton.isVisible().catch(() => false)) return byButton.click({ timeout: timeoutMs });
  await page.getByText(quoted, { exact: false }).first().click({ timeout: timeoutMs });
}

// ----- 2. Screenshots -> MP4 (ffmpeg, no browser) -----

export interface SlicesOptions {
  frameRate?: number; // frames per second; each screenshot holds for 1/frameRate s
  scale?: string; // ffmpeg scale filter, e.g. "1280:-2"
}

/** Assemble a set of PNG screenshots (sorted by name) into one video.
 *  Returns the output path. Requires ffmpeg on the PATH. */
export async function screenshotsToVideo(pngPaths: string[], outPath: string, opts: SlicesOptions = {}): Promise<string> {
  if (!pngPaths.length) throw new Error("No screenshots to assemble.");
  const dir = dirname(outPath);
  mkdirSync(dir, { recursive: true });

  const staging = `${dir}/.staging-${basename(outPath)}-${process.pid}`;
  mkdirSync(staging, { recursive: true });
  const pad = String(pngPaths.length).length;
  pngPaths.forEach((p, i) => copyFileSync(p, `${staging}/${String(i + 1).padStart(pad, "0")}.png`));

  const scale = opts.scale ?? "1280:-2";
  const frameRate = opts.frameRate ?? 1;
  await runFfmpeg([
    "-y",
    "-framerate",
    String(frameRate),
    "-i",
    `${staging}/%0${pad}d.png`,
    "-vf",
    `scale=${scale}`,
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outPath,
  ]);
  rmSync(staging, { recursive: true, force: true });
  return outPath;
}

// ----- 3. Raw screen capture (ffmpeg AVFoundation, macOS) -----

export interface ScreencastOptions {
  /** AVFoundation device index from `ffmpeg -f avfoundation -list_devices true -i ""`.
   *  "Capture screen 0"/"Capture screen 1" typically map to indices 2 and 3. */
  deviceIndex?: number;
  durationMs?: number;
  framerate?: number;
}

/** Records the mac screen to an MP4. Blocks for durationMs (default 30s).
 *  Captures whatever is on screen - the explorer, reports, or the user
 *  driving the app. Requires ffmpeg. */
export async function recordDesktopScreen(outPath: string, opts: ScreencastOptions = {}): Promise<string> {
  mkdirSync(dirname(outPath), { recursive: true });
  const device = opts.deviceIndex ?? 2;
  const framerate = opts.framerate ?? 12;
  const fpsFilter = String(framerate);
  const args = ["-f", "avfoundation", "-framerate", String(framerate), "-capture_cursor", "1", "-i", `${device}:none`];
  if (opts.durationMs) args.push("-t", String(opts.durationMs / 1000));
  args.push("-vf", `fps=${fpsFilter}`, "-pix_fmt", "yuv420p", "-movflags", "+faststart", outPath);
  await runFfmpeg(args);
  return outPath;
}

/** Start capturing the mac screen in the background (ffmpeg AVFoundation) and
 *  return a handle to stop it. Used by demo --os-cursor so the walkthrough runs
 *  concurrently with recording, capturing the real OS cursor. */
export function startDesktopCapture(outPath: string, opts: ScreencastOptions = {}): { stop: () => Promise<void> } {
  mkdirSync(dirname(outPath), { recursive: true });
  const device = opts.deviceIndex ?? 2;
  const framerate = opts.framerate ?? 30;
  const args = [
    "-y", "-f", "avfoundation", "-framerate", String(framerate), "-capture_cursor", "1", "-i", `${device}:none`,
    "-vf", `fps=${framerate}`, "-pix_fmt", "yuv420p", outPath,
  ];
  const proc = spawn("ffmpeg", args, { stdio: "ignore" });
  let stopped = false;
  return {
    stop: () =>
      new Promise<void>((resolve) => {
        if (stopped) return resolve();
        stopped = true;
        const done = () => {
          if (proc.exitCode !== null && proc.exitCode !== 0) {
            // ffmpeg returns non-zero on SIGINT-clean exits too; only surface
            // if it never produced a file. The caller probes the file anyway.
          }
          resolve();
        };
        proc.on("exit", done);
        // SIGINT lets ffmpeg finalize the moov atom; if it ignores that
        // (AVFoundation sometimes hangs on it), escalate to SIGKILL after a
        // short grace so we never leave an orphan holding the capture device.
        proc.kill("SIGINT");
        setTimeout(() => {
          if (proc.exitCode === null) proc.kill("SIGKILL");
        }, 3000);
        setTimeout(() => resolve(), 6000); // never hang on a stuck ffmpeg
      }),
  };
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("ffmpeg", args, { maxBuffer: 1024 * 1024 * 16 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg failed: ${stderr || err.message}`));
      else resolve(void stdout);
    });
  });
}

function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9-_]/g, "_") || "path";
}