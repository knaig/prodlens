// Walkthrough orchestrator: the user-facing path for LLM-drafted product
// demos. Flow: build surface -> pick adapter -> LLM draft manifest+plan ->
// resolve resources -> review (interactive) -> execute primitives in a
// browser -> render narrated video (reusing the explain pipeline).
import { chromium, type Page } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAuthedContext, type AuthConfig } from "../discovery/auth.js";
import { addCursorOverlay, activatePlaywrightBrowser, readWindowGeometry, lockCursorToWindow, announceTakeover, confirmScreenCapture, makeWindowFullscreen, addStopControl, exposeStopRelease, pageStopRequested, viewportToScreen } from "../execution/os-cursor.js";
import { startDesktopCapture } from "../execution/capture.js";
import { selectAdaptersAsync, resolvePlanResources, partitionPlanByResources, loadExternalAdapter } from "./engine.js";
import { draftManifestAndPlan } from "./llm-draft.js";
import { reviewWalkthroughInteractive } from "./review-form.js";
import { buildSurface } from "./surface.js";
import { flowFromGraph } from "./diagrams.js";
import "./web-adapter.js"; // registers the core web adapter at import time
import type { ProdlensAdapter, ProductManifest, ProductSurface, SceneSpec, WalkthroughPlan } from "./types.js";
import { renderNarratedVideo } from "../execution/explain.js";
import type { ExplainScene } from "../execution/explain.js";

export interface WalkthroughOptions {
  dataDir?: string;
  repoRoot?: string;
  docDirs?: string[];
  description?: string;
  baseUrl?: string;
  adapter?: string;
  model?: string;
  skipReview?: boolean;
  /** Modes to force into the plan (ux/flow/architecture...). */
  modes?: string[];
  /** Drive the REAL OS cursor (cliclick) + record the screen - the pointer in
   *  the video is the actual OS cursor. Browser window must stay frontmost. */
  osCursor?: boolean;
  /** When true (or when no adapter matches and a repo is present), synthesize
   *  a product adapter from the repo on the fly instead of requiring one. */
  synthesize?: boolean;
  /** Where a synthesized adapter is written (default <repoRoot>/prodlens). */
  adapterOutDir?: string;
  /** Cap on how many repo file contents to include in the surface prompt
   *  (fewer = faster draft; default 15 for walkthrough, 40 for synthesis). */
  maxFileContents?: number;
  /** Auth for reaching the product (strategy, email, password, storageState). */
  auth?: {
    strategy: string;
    email?: string;
    password?: string;
    storageStatePath?: string;
    localStorageToken?: boolean;
  };
  /** Progress callback for streaming status to a caller (e.g. web app). */
  onProgress?: (stage: string, detail?: string) => void;
  /** When true, the walkthrough should stop ASAP (web app "stop" button). */
  stopRequested?: () => boolean;
}

export interface WalkthroughResult {
  plan: WalkthroughPlan;
  manifest: ProductManifest;
  videoPath?: string;
  screenplayPath?: string;
}

async function pageReady(page: Page, baseUrl: string, entry: string): Promise<void> {
  await page.goto(`${baseUrl}${entry}`, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => null);
  await page.waitForTimeout(1200);
}

/** Render the reviewed plan into a narrated video by executing browser scenes
 *  live and capturing screenshots, plus any flow/architecture diagram scenes
 *  as static slides. */
async function renderPlan(
  adapter: ProdlensAdapter,
  plan: WalkthroughPlan,
  manifest: ProductManifest,
  surface: ProductSurface,
  outPath: string,
  opts: WalkthroughOptions
): Promise<{ videoPath: string; screenplayPath: string }> {
  const workDir = `${dirname(outPath)}/.walk-${Date.now()}`;
  mkdirSync(workDir, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const baseUrl = ((manifest.surfaces as { baseUrl?: string })?.baseUrl ?? opts.baseUrl ?? "http://localhost:3000").replace(/\/$/, "");
  const entry = (manifest.entry as string) ?? "/";
  const authConfig: AuthConfig | undefined = opts.auth
    ? {
        strategy: opts.auth.strategy as AuthConfig["strategy"],
        baseUrl,
        protectedPath: entry,
        email: opts.auth.email,
        password: opts.auth.password,
        localStorageToken: opts.auth.localStorageToken,
        storageStatePath: opts.auth.storageStatePath ?? `${workDir}/session.json`,
      }
    : undefined;
  let page: Page;
  let browserCtx;
  if (authConfig && authConfig.strategy !== "none") {
    browserCtx = await getAuthedContext(browser, authConfig);
    page = await browserCtx.newPage();
  } else {
    browserCtx = await browser.newContext();
    page = await browserCtx.newPage();
  }
  if (!opts.osCursor) await addCursorOverlay(browserCtx);
  await pageReady(page, baseUrl, entry);

  // In OS-cursor mode: EXPLICIT consent is required first. If granted, lock the
  // cursor, record the real screen (with the real pointer), and mix narration
  // onto that recording. If declined, fall back to DOM-overlay + page
  // screenshots (no screen capture, no lock).
  let osGeom: import("../execution/os-cursor.js").WindowGeometry | undefined;
  let osLock: import("../execution/os-cursor.js").CursorLock | undefined;
  let osCapture: ReturnType<typeof startDesktopCapture> | undefined;
  const t0 = Date.now();
  const narrated: { file: string; atSec: number; durSec: number }[] = [];
  if (opts.osCursor) {
    const ok = await confirmScreenCapture("The walkthrough");
    if (!ok) {
      console.warn("[prodlens] Screen capture not consented - falling back to DOM-overlay recording (no screen capture).");
      opts = { ...opts, osCursor: false };
      if (addCursorOverlay) await addCursorOverlay(browserCtx);
    } else {
      await announceTakeover("prodlens walkthrough").catch(() => null);
      const activeBundle = await activatePlaywrightBrowser(browser).catch(() => undefined);
      // Size the recording window to the main display (CDP) so nothing overlays
      // it, and give the operator an in-page Stop button they can actually
      // reach (the mouse is locked to this window).
      await makeWindowFullscreen(page).catch(() => null);
      await addStopControl(browserCtx);
      osGeom = await readWindowGeometry(page).catch(() => undefined);
      if (osGeom) {
        osLock = lockCursorToWindow(osGeom, { maxMs: 10 * 60 * 1000, appBundleId: activeBundle ?? "com.google.chrome.for.testing" });
        await exposeStopRelease(page, () => osLock?.release());
        setTimeout(() => osLock?.release(), 9 * 60 * 1000); // hard release as backstop
      }
      osCapture = startDesktopCapture(join(workDir, "screen.mp4"), { framerate: 30, deviceIndex: 2 });
      await new Promise((r) => setTimeout(r, 600)); // let ffmpeg open the device
    }
  }

  const scenes: ExplainScene[] = [];
  const ctx = { surface, workDir, manifest, page, osCursor: osGeom ? { geom: osGeom } : undefined };

  const shouldStop = async () => {
    if (opts.stopRequested?.() ?? false) return true;
    if (osLock?.aborted) return true;
    if (osCapture && !page.isClosed()) return (await pageStopRequested(page).catch(() => false));
    return false;
  };

  for (const scene of plan.scenes) {
    // Manual override or web "stop" button: stop the walkthrough now.
    if (await shouldStop()) {
      console.warn("\n[walkthrough] stopped by operator - saving what we have.");
      break;
    }
    // Browser died (guessed selectors crashed it) - stop rather than fail every
    // remaining scene against a closed page.
    if (page.isClosed()) {
      console.warn("\n[walkthrough] browser closed - stopping scene execution; saving what we have.");
      break;
    }
    // Progress so the web UI shows the operator which scene is live now.
    if (opts.onProgress) opts.onProgress("scene", scene.name);
    // Park the cursor in the middle of the viewport at scene start so the
    // recording shows active cursor motion even for goto/screenshot scenes.
    if (osGeom && !page.isClosed()) {
      const { osMove } = await import("../execution/os-cursor.js");
      const mid = viewportToScreen(osGeom, (osGeom.innerW / osGeom.dpr) / 2, (osGeom.innerH / osGeom.dpr) / 2);
      await osMove(mid.x, mid.y).catch(() => null);
    }
    const kind = scene.name.toLowerCase();
    if (kind.includes("persona")) {
      // Persona intro card: render as a static slide (no browser needed).
      const { personaToPng } = await import("./diagrams.js");
      const png = join(workDir, `persona-${scenes.length}.png`);
      const ps = scene.primitives.find((p) => p.op === "persona.set");
      const args = (ps?.args ?? {}) as Record<string, unknown>;
      await personaToPng(
        {
          name: (args.name as string) ?? scene.name,
          role: args.role as string | undefined,
          problem: (args.problem as string) ?? scene.narrate ?? "",
          goal: (args.goal as string) ?? scene.narrate ?? "",
        },
        png
      );
      scenes.push({ png, narrate: scene.narrate });
      continue;
    }
    if (kind.includes("flow")) {
      // Render a flow diagram as a static slide scene.
      const flow = flowFromGraph(surface);
      if (flow) {
        const { mermaidToPng, flowToMermaid } = await import("./diagrams.js");
        const png = join(workDir, `flow-${scenes.length}.png`);
        await mermaidToPng(flowToMermaid(flow), png);
        scenes.push({ png, narrate: scene.narrate });
        continue;
      }
    }
    // Otherwise: execute the scene's browser primitives. In OS-cursor mode we
    // record the narration timestamp so the clip is mixed onto the screen
    // recording at the moment it happens.
    const sceneStart = (Date.now() - t0) / 1000;
    let lastShot: string | undefined;
    for (const p of scene.primitives) {
      if (await shouldStop()) break;
      let res;
      try {
        res = await adapter.execute(p, ctx);
      } catch (e) {
        console.warn(`  [walkthrough] scene "${scene.name}" step ${p.op} failed: ${e instanceof Error ? e.message : String(e)}`);
        continue; // a guessed selector/timeout shouldn't kill the whole demo
      }
      if (!res.ok) {
        console.warn(`  [walkthrough] scene "${scene.name}" step ${p.op}: ${res.error ?? "failed"}`);
        continue;
      }
      const shot = res.artifacts?.find((a) => a.kind === "screenshot");
      if (shot) lastShot = shot.path;
    }

    // Result semantics: if the scene expects a URL change, wait for it so the
    // captured frame shows the RESULT of the action, not the pre-action state.
    if (scene.expect?.urlIncludes) {
      const want = scene.expect.urlIncludes;
      try {
        if (!page.isClosed()) {
          await page.waitForURL((u) => u.pathname.includes(want) || u.href.includes(want), { timeout: 12000 });
          await page.waitForTimeout(scene.expect.settleMs ?? 800);
        }
      } catch {
        /* page closed or URL never matched - show what we have */
      }
    }

    if (osCapture) {
      // Narration clip mixed onto the screen recording at this scene's time.
      if (scene.narrate) {
        const audio = join(workDir, `narr-${scenes.length}.wav`);
        const { synthNarration, probeDuration } = await import("../execution/explain.js");
        try {
          await synthNarration(scene.narrate, "Kore", 180, "", audio);
          const durSec = await probeDuration(audio).catch(() => 0);
          narrated.push({ file: audio, atSec: sceneStart, durSec });
        } catch {
          console.warn(`  [walkthrough] narration failed for scene "${scene.name}"`);
        }
      }
      continue; // no per-scene screenshot in osCursor mode - the screen recording is the video
    }
    if (!lastShot) {
      // No screenshot captured - the scene's actions all failed (guessed
      // selectors, auth, etc). Take a best-effort shot of the current page; if
      // even that fails (page closed), skip the scene rather than crash the
      // whole render.
      lastShot = join(workDir, `scene-${scenes.length}.png`);
      try {
        await page.screenshot({ path: lastShot });
      } catch {
        console.warn(`  [walkthrough] scene "${scene.name}": no screenshot available - skipping.`);
        continue;
      }
    }
    scenes.push({ png: lastShot, narrate: scene.narrate });
  }

  const screenplayPath = outPath.replace(/\.mp4$/, "") + ".screenplay.json";
  writeFileSync(screenplayPath, JSON.stringify({ title: plan.title, scene: scenes }, null, 2));

  let videoPath: string;
  try {
    if (osCapture && osGeom) {
      // Mix narration onto the real screen recording (crop to the app window).
      await osCapture.stop();
      const { renderVideo } = await import("../execution/demo.js");
      const raw = join(workDir, "screen.mp4");
      const cropRect = {
        x: Math.round(osGeom.screenX * osGeom.dpr),
        y: Math.round(osGeom.screenY * osGeom.dpr),
        w: Math.round(osGeom.outerW * osGeom.dpr),
        h: Math.round(osGeom.outerH * osGeom.dpr),
      };
      const endSec = narrated.length ? Math.max(...narrated.map((n) => n.atSec + n.durSec)) + 1.2 : undefined;
      await renderVideo(raw, narrated, [], [], outPath, "1280:-2", true, false, endSec, cropRect);
      videoPath = outPath;
    } else {
      videoPath = await renderNarratedVideo(scenes, outPath, { voice: "Kore", scale: "1280:-2", trailing: 0.2 });
    }
  } finally {
    if (osLock) osLock.release();
    await browser.close();
  }
  return { videoPath, screenplayPath };
}

export async function runWalkthrough(outPath: string, opts: WalkthroughOptions): Promise<WalkthroughResult> {
  const progress = opts.onProgress ?? (() => {});
  const surface = buildSurface({ ...opts, maxFileContents: opts.maxFileContents ?? 15 });
  progress("surface", `built surface: ${Object.keys((surface.graph as { nodes?: unknown } | undefined)?.nodes ?? {}).length} screens, ${surface.fileContents?.length ?? 0} files read`);
  let adapters = await selectAdaptersAsync(surface, opts.adapter);

  // Adapter synthesis on the fly: if nothing matches (or synthesis is forced)
  // and we have the repo, generate a product adapter now.
  if ((!adapters.length || opts.synthesize) && opts.repoRoot) {
    progress("synthesize", "no matching adapter - generating one from the repo...");
    console.log("No matching adapter - synthesizing one from the repo...");
    const { synthesizeAdapter } = await import("./synthesis.js");
    const outDir = opts.adapterOutDir ?? join(opts.repoRoot, "prodlens");
    const { path: adapterPath } = await synthesizeAdapter(surface, { outDir, model: opts.model });
    await loadExternalAdapter(adapterPath);
    adapters = await selectAdaptersAsync(surface);
    progress("synthesize", `adapter written: ${adapterPath}`);
  }

  if (!adapters.length) throw new Error("No adapter can drive this product surface. Register an adapter, supply discovery/docs/source, or pass a repo with --synthesize.");

  // Draft with the first (or preferred) matching adapter.
  const adapter = adapters[0];
  progress("draft", `drafting manifest + walkthrough with ${adapter.name}...`);
  const draft = await draftManifestAndPlan(adapter, surface, { model: opts.model });
  const manifest = draft.manifest;
  if (opts.baseUrl && !manifest.surfaces?.baseUrl) manifest.surfaces = { ...(manifest.surfaces ?? {}), baseUrl: opts.baseUrl };
  const plan = draft.plan;
  if (opts.modes?.length) plan.mode = opts.modes;
  progress("draft", `${plan.scenes.length} scenes drafted (modes: ${plan.mode.join(", ")})`);

  const resources = await resolvePlanResources(adapter, plan, surface);

  let reviewed = plan;
  // Always persist the draft manifest + plan for the user to inspect/edit.
  writeFileSync(outPath.replace(/\.mp4$/, "") + ".plan.json", JSON.stringify({ manifest, plan }, null, 2));
  writeFileSync(outPath.replace(/\.mp4$/, "") + ".manifest.json", JSON.stringify(manifest, null, 2));
  if (!opts.skipReview) {
    reviewed = await reviewWalkthroughInteractive(plan, resources);
    writeFileSync(outPath.replace(/\.mp4$/, "") + ".plan.json", JSON.stringify({ manifest, plan: reviewed }, null, 2));
  }

  // Execute + render. Scenes whose resources are blocked are SKIPPED with a
  // note (the demo still renders the parts that need nothing external) - the
  // user can supply the resources and re-run, or edit the plan.
  const { runnable, blocked } = await partitionPlanByResources(adapter, reviewed, surface);
  if (blocked.length) {
    console.warn(`\nSkipping ${blocked.length} scene(s) whose resources are blocked:`);
    for (const b of blocked) console.warn(`  - ${b.scene.name}: ${b.resources.join("; ")}`);
    progress("resources", `skipping ${blocked.length} scene(s) with blocked resources`);
  }
  if (!runnable.scenes.length) throw new Error("Every scene needs a blocked resource - supply them and re-run, or edit the plan.");

  progress("render", `executing ${runnable.scenes.length} scenes + rendering narrated video...`);
  const { videoPath, screenplayPath } = await renderPlan(adapter, runnable, manifest, surface, outPath, opts);
  progress("done", `video written: ${videoPath}`);
  return { plan: runnable, manifest, videoPath, screenplayPath };
}

export { buildSurface };
