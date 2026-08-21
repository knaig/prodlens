// Real OS cursor driver for demos. When recording a product walkthrough with
// `--os-cursor`, the actual mouse pointer is moved and clicked on the real
// screen via cliclick (macOS), and the video is the recorded screen (see
// recordDesktopScreen in capture.ts) rather than an in-page Playwright
// recording. This gives a genuinely accurate, zero-lag cursor that a DOM
// overlay cannot match - the pointer you see is the OS pointer.
//
// Coordinate model: Playwright works in viewport CSS pixels; the OS works in
// screen points. The mapping needs the browser window's geometry (screenX/Y,
// outer/inner size, devicePixelRatio) which we read once from the page:
//   screenX = window.screenX + chromeX + viewportX
//   screenY = window.screenY + chromeY + viewportY
// where chromeX = (outerWidth - innerWidth)/2, chromeY = outerHeight-innerHeight.
// Clicks land at the element center as Playwright computed it, but executed by
// the real cursor.
import { execFile } from "node:child_process";

export interface WindowGeometry {
  screenX: number;
  screenY: number;
  outerW: number;
  outerH: number;
  innerW: number;
  innerH: number;
  dpr: number;
}

/** SVG pointer injected into every page so the recording shows a visible cursor
 *  (used by the DOM-overlay path in demo + walkthrough). Tracks mouse events
 *  via an init script, so it survives full navigations. pointer-events:none
 *  keeps the overlay inert. */
export function addCursorOverlay(context: import("playwright").BrowserContext): Promise<unknown> {
  const svg =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      '<svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg"><path d="M4 2 L4 19 L8 15 L11 20 L13.5 18.5 L10.5 13.5 L15 13.5 Z" fill="black" fill-opacity="0.9" stroke="white" stroke-width="1.6" stroke-linejoin="round"/></svg>'
    );
  // NOTE: passed as a STRING, not a function. tsx/esbuild transpile function
  // callbacks with helper calls (e.g. __name) that don't exist inside the page,
  // so a function-form init script throws silently there and the overlay never
  // appears. A string is transpiler-immune.
  return context.addInitScript(`(() => {
    const w = window;
    if (w.__prodlensCursor) return;
    const src = ${JSON.stringify(svg)};
    const inject = () => {
      if (w.__prodlensCursor) return;
      if (!document.documentElement) return;
      w.__prodlensCursor = true;
      const el = document.createElement("img");
      el.id = "prodlens-cursor";
      el.src = src;
      Object.assign(el.style, {
        position: "fixed",
        left: "0px",
        top: "0px",
        width: "22px",
        height: "22px",
        pointerEvents: "none",
        zIndex: "2147483647",
        transform: "translate(-1px, -1px)",
      });
      document.documentElement.appendChild(el);
      const place = (x, y) => {
        el.style.left = x + "px";
        el.style.top = y + "px";
      };
      document.addEventListener("mousemove", (e) => place(e.clientX, e.clientY));
      document.addEventListener("mousedown", () => {
        el.style.transform = "translate(0px, 0px)";
        el.style.filter = "brightness(0.75)";
      });
      document.addEventListener("mouseup", () => {
        el.style.transform = "translate(-1px, -1px)";
        el.style.filter = "";
      });
    };
    inject();
    document.addEventListener("DOMContentLoaded", inject, { once: true });
  })();`);
}

/** Read the browser window's geometry from the page - used to translate
 *  viewport coords into real screen coordinates for the OS cursor. */
export function readWindowGeometry(page: import("playwright").Page): Promise<WindowGeometry> {
  return page.evaluate(() => ({
    screenX: window.screenX,
    screenY: window.screenY,
    outerW: window.outerWidth,
    outerH: window.outerHeight,
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    dpr: window.devicePixelRatio,
  }));
}

/** Viewport (CSS px) -> screen (points) translation. */
export function viewportToScreen(g: WindowGeometry, x: number, y: number): { x: number; y: number } {
  const chromeX = (g.outerW - g.innerW) / 2;
  const chromeY = g.outerH - g.innerH;  return { x: g.screenX + chromeX + x * g.dpr, y: g.screenY + chromeY + y * g.dpr };
}

/** Bring the given app to the front so the real cursor's clicks land on it.
 *  `bundleId` is the app's bundle identifier (e.g. com.google.Chrome). */
export async function activateApp(bundleId: string): Promise<void> {
  await runCliclick(["w:200"]);
  await execFileAsync("osascript", [
    "-e",
    `tell application id "${bundleId}" to activate`,
  ]);
  await runCliclick(["w:300"]);
}

const BROWSER_BUNDLE_FALLBACKS = ["com.google.chrome.for.testing", "org.chromium.Chromium", "com.google.Chrome"];

/** Resolve the bundle id of a running app by its OS process id, using AppleScript
 *  System Events. Returns null if it can't be determined. */
export function bundleIdForPid(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "osascript",
      [
        "-e",
        `tell application "System Events" to get bundle identifier of (first application process whose unix id is ${pid})`,
      ],
      { maxBuffer: 1024 * 1024 * 8 },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const id = String(stdout).trim();
        resolve(id && id.length ? id : null);
      }
    );
  });
}

/** Bring an already-running app's process to the front WITHOUT asking macOS to
 *  activate the app by name - activating by bundle id can spawn a SECOND window
 *  for Playwright-launched browsers (temp profile). Setting frontmost on the
 *  existing process id raises that exact window, no new one. */
export function bringProcessToFront(pid: number): Promise<void> {
  return execFileAsync("osascript", [
    "-e",
    `tell application "System Events" to set frontmost of (first application process whose unix id is ${pid}) to true`,
  ]).catch(() => {});
}

/** Find the OS pid of the running Playwright Chromium by matching its process
 *  name, then bring THAT exact window to the front (no AppleScript "activate"
 *  which can spawn a second window). Returns the resolved bundle id for
 *  downstream use (fallback id if pid resolution fails). */
export async function activatePlaywrightBrowser(browser: import("playwright").Browser, fallbackBundleId?: string): Promise<string | undefined> {
  // Resolve the pid by process name (browser.process() is not in the public
  // API). Match the newest/first running instance.
  let pid: number | undefined;
  for (const name of ["Google Chrome for Testing", "Chromium", "Google Chrome"]) {
    const found = await new Promise<number | undefined>((resolve) => {
      execFile("pgrep", ["-f", name], { maxBuffer: 1024 * 1024 * 8 }, (err, stdout) => {
        if (err || !stdout) return resolve(undefined);
        const first = String(stdout).trim().split("\n")[0];
        const n = first ? Number(first) : NaN;
        resolve(isNaN(n) ? undefined : n);
      });
    });
    if (found) {
      pid = found;
      break;
    }
  }

  if (pid) {
    const resolved = await bundleIdForPid(pid);
    if (resolved) {
      await bringProcessToFront(pid);
      return resolved;
    }
  }
  // Fallback: activate by known bundle ids (last resort).
  for (const id of [fallbackBundleId, ...BROWSER_BUNDLE_FALLBACKS]) {
    if (!id) continue;
    try {
      await activateApp(id);
      return id;
    } catch {
      /* try next */
    }
  }
  return undefined;
}

/** Inject an in-page "STOP" control into the recorded product window. Because
 *  os-cursor locks the real mouse to this window, the operator needs a Stop
 *  button they can actually click - not the web app's button in another window.
 *  Clicking it sets window.__prodlensStop = true (checked by the walkthrough
 *  loop) and also releases the cursor lock via a page function if available. */
export function addStopControl(context: import("playwright").BrowserContext): Promise<unknown> {
  // String form for the same reason as addCursorOverlay: function-form init
  // scripts break when transpiled by tsx/esbuild (page-side helper refs).
  return context.addInitScript(`(() => {
    const w = window;
    if (w.__prodlensStop !== undefined) return;
    w.__prodlensStop = false;
    const inject = () => {
      if (!document.documentElement) return;
      if (document.getElementById("prodlens-stop")) return;
      const btn = document.createElement("button");
      btn.id = "prodlens-stop";
      btn.textContent = "\\u25A0 STOP";
      Object.assign(btn.style, {
        position: "fixed",
        top: "16px",
        right: "16px",
        zIndex: "2147483647",
        background: "#dc2626",
        color: "#fff",
        border: "none",
        borderRadius: "8px",
        padding: "10px 16px",
        fontSize: "15px",
        fontWeight: "700",
        cursor: "pointer",
        boxShadow: "0 2px 10px rgba(0,0,0,.5)",
        fontFamily: "inherit",
      });
      btn.addEventListener("click", () => {
        w.__prodlensStop = true;
        if (typeof w.__prodlensStopFn === "function") w.__prodlensStopFn();
        btn.style.background = "#991b1b";
        btn.textContent = "STOPPED";
      });
      document.documentElement.appendChild(btn);
    };
    inject();
    document.addEventListener("DOMContentLoaded", inject, { once: true });
  })();`);
}

/** Expose a release callback into the page so the in-page Stop button can
 *  release the cursor lock immediately (the page can't call cliclick, so the
 *  engine wires this in). */
export async function exposeStopRelease(page: import("playwright").Page, releaseFn: () => void): Promise<void> {
  await page.evaluate((fnSrc) => {
    (window as unknown as { __prodlensStopFn?: () => void }).__prodlensStopFn = new Function(fnSrc) as () => void;
  }, releaseFn.toString()).catch(() => null);
}

/** Whether the in-page Stop button was clicked on this page. */
export async function pageStopRequested(page: import("playwright").Page): Promise<boolean> {
  return page
    .evaluate(() => (window as unknown as { __prodlensStop?: boolean }).__prodlensStop === true)
    .catch(() => false);
}

/** Size the recording browser window to the main display so no other window
 *  overlays it during screen capture. Uses CDP (Browser.setWindowBounds) on the
 *  exact Playwright window - reliable and won't spawn a second window like
 *  AppleScript "activate" can. Best effort, non-fatal on failure. */
export async function makeWindowFullscreen(page: import("playwright").Page): Promise<void> {
  try {
    const cdp = await (page.context() as import("playwright").BrowserContext).newCDPSession(page);
    const { windowId } = (await cdp.send("Browser.getWindowForTarget")) as { windowId: number };
    // Main display resolution in points. Query the desktop bounds.
    const screen = await new Promise<{ w: number; h: number } | null>((resolve) => {
      execFile("osascript", ["-e", "tell application \"Finder\" to get bounds of window of desktop"], { maxBuffer: 1024 * 1024 * 8 }, (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const m = String(stdout).trim().match(/(-?\d+),\s*(-?\d+),\s*(\d+),\s*(\d+)/);
        if (!m) return resolve(null);
        resolve({ w: Number(m[3]), h: Number(m[4]) });
      });
    });
    const w = screen?.w ?? 1920;
    const h = screen?.h ?? 1080;
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { left: 0, top: 0, width: w, height: h, windowState: "normal" } });
  } catch {
    /* non-fatal - recording still works, just not fullscreen */
  }
}

/** Move the real cursor to a screen point with a natural, eased glide. */
export async function osMove(x: number, y: number, easing = 3): Promise<void> {
  recordDemoMove(x, y);
  await runCliclick(["-e", String(easing), `m:${Math.round(x)},${Math.round(y)}`]);
}

/** Click at a screen point with the real cursor (move + press + release). */
export async function osClick(x: number, y: number): Promise<void> {
  recordDemoMove(x, y);
  await runCliclick(["-e", "3", `c:${Math.round(x)},${Math.round(y)}`]);
}

/** Move to a point, press the button, dwell, release - like humanClick but on
 *  the real OS pointer. cliclick 5.1 uses dd:/du: (drag down/up) for press. */
export async function osHumanClick(x: number, y: number): Promise<void> {
  recordDemoMove(x, y);
  await runCliclick(["-e", "3", `m:${Math.round(x)},${Math.round(y)}`, "w:140", `dd:${Math.round(x)},${Math.round(y)}`, "w:80", `du:${Math.round(x)},${Math.round(y)}`, "w:120"]);
}

/** Move the cursor into the viewport center (so wheel events have a target),
 *  then scroll the page via Playwright - the page scrolls under the stationary
 *  real cursor, which is exactly how a human scrolls. */
export async function osScroll(
  page: import("playwright").Page,
  g: WindowGeometry,
  mode: "down" | "tour"
): Promise<void> {
  const scrollable = await page
    .evaluate(() => {
      const de = document.documentElement;
      return de.scrollHeight > de.clientHeight + 40;
    })
    .catch(() => false);
  if (!scrollable) return;

  // Park the real cursor in the middle of the viewport where the wheel will
  // act, so the pointer is visibly hovering the content while it scrolls.
  const cx = viewportToScreen(g, g.innerW / 2 / g.dpr, g.innerH / 2 / g.dpr);
  await osMove(cx.x, cx.y);

  const step = 320;
  const pauseMs = 60;
  let y = 0;
  const maxY = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight).catch(() => 0);

  const scrollDown = async () => {
    while (y < maxY - 20) {
      await page.mouse.wheel(0, step);
      y += step;
      await page.waitForTimeout(pauseMs);
    }
  };
  await scrollDown();
  await page.waitForTimeout(250);
  if (mode === "tour") {
    while (y > 0) {
      await page.mouse.wheel(0, -step);
      y -= step;
      await page.waitForTimeout(pauseMs);
    }
    await page.waitForTimeout(150);
  }
}

/** Type text via Playwright's keyboard (real cursor already parked in the
 *  field by the caller's osClick). */
export function osType(page: import("playwright").Page, text: string): Promise<void> {
  return page.keyboard.type(text, { delay: 45 });
}

function runCliclick(args: string[]): Promise<void> {
  return execFileAsync("cliclick", args);
}

function execFileAsync(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 8 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`${cmd} failed: ${stderr || err.message}`));
      else resolve();
    });
  });
}

/** Read the current mouse position (screen points) via cliclick. */
function readMousePos(): Promise<{ x: number; y: number } | null> {
  return new Promise((resolve) => {
    execFile("cliclick", ["p"], { maxBuffer: 1024 * 1024 * 8 }, (err, stdout) => {
      if (err) return resolve(null);
      const m = String(stdout).trim().match(/^(-?\d+)[, ](-?\d+)/);
      resolve(m ? { x: Number(m[1]), y: Number(m[2]) } : null);
    });
  });
}

export interface CursorLock {
  release: () => void;
  /** True after the user pressed the abort key (manual override). */
  aborted: boolean;
}

/** Keys that manually release the cursor lock and abort the demo. Enter is the
 *  primary "remote-control" kill; Escape/X/Q also work. */
export const LOCK_ABORT_KEYS = ["escape", "x", "q", "\r", "\n", "enter", "return"];

/** Last screen position the demo itself moved the cursor to, and when. The
 *  guard uses this as the lock anchor: if the operator's mouse deviates from it
 *  (and the demo isn't mid-glide), the cursor is warped back. */
let demoCursor = { x: -1, y: -1, at: 0 };

function recordDemoMove(x: number, y: number): void {
  demoCursor = { x, y, at: Date.now() };
}

/** Show a non-blocking macOS notification that prodlens is taking control, so
 *  the operator isn't surprised when the cursor stops following them. */
export function announceTakeover(appName: string): Promise<void> {
  return execFileAsync("osascript", [
    "-e",
    `display notification "prodlens is taking control of the mouse to record a demo. Press Enter at any time to stop." with title "${appName}"`,
  ]).catch(() => {});
}

/** Ask the operator for EXPLICIT consent before starting a screen recording.
 *  Screen capture is sensitive - never start one without a clear yes. Returns
 *  true only when the user answers affirmatively on stdin. If stdin is not a
 *  TTY, returns false (no recording without consent). */
/** A pluggable consent resolver. When set, confirmScreenCapture delegates to it
 *  instead of reading stdin (used by the web app to surface a web consent
 *  prompt). Set to null/undefined to revert to stdin. */
let screenCaptureConsentResolver: ((what: string) => Promise<boolean>) | undefined;

export function setScreenCaptureConsentResolver(fn: ((what: string) => Promise<boolean>) | undefined): void {
  screenCaptureConsentResolver = fn;
}

export function confirmScreenCapture(what: string): Promise<boolean> {
  if (screenCaptureConsentResolver) return screenCaptureConsentResolver(what);
  return new Promise((resolve) => {
    let stdin: NodeJS.ReadStream | undefined;
    try {
      stdin = process.stdin;
      if (!stdin.isTTY) {
        console.error(
          `[prodlens] ${what} needs screen capture, but stdin is not a TTY and no interactive consent can be asked.\n` +
            `Refusing to start screen recording. Re-run in an interactive terminal, or skip --os-cursor.`
        );
        return resolve(false);
      }
    } catch {
      return resolve(false);
    }
    const rl = require("node:readline").createInterface({ input: stdin, output: process.stdout });
    rl.question(
      `\n[prodlens] ${what} will RECORD YOUR SCREEN (AVFoundation) to capture the real cursor.\n` +
        `Your screen (including any visible windows) will be recorded. Type "yes" to allow, or "no" to cancel:\n> `,
      (answer: string) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === "yes");
      }
    );
  });
}

/** Lock the real cursor to wherever the demo wants it for the duration of a
 *  recording. DISABLED for now: the warp-back guard proved unreliable (could
 *  trap the operator's mouse on the wrong window). This is now a no-op that
 *  does NOT touch the mouse at all - it only keeps the stdin abort-key listener
 *  (Enter/Escape/X/Q) so a run can still be stopped. The operator manages the
 *  mouse themselves; screen capture runs with consent only.
 */
export function lockCursorToWindow(g: WindowGeometry, opts: { maxMs?: number; appBundleId?: string } = {}): CursorLock {
  let released = false;
  let aborted = false;
  const lock: CursorLock = {
    release: () => {
      if (released) return;
      released = true;
      process.stdin.removeListener("data", onKey);
      try {
        process.stdin.setRawMode(false);
      } catch {
        // not a TTY - ignore
      }
    },
    aborted: false,
  };

  const onKey = (chunk: Buffer) => {
    if (released) return;
    const key = chunk.toString();
    const lower = key.toLowerCase();
    if (key.includes("\u001b") || LOCK_ABORT_KEYS.includes(lower.trim()) || key.includes("x") || key.includes("q")) {
      aborted = true;
      lock.aborted = true;
      lock.release();
      console.log("\n[prodlens] abort key pressed - stopping demo.");
    }
  };

  // Listen for the abort key on stdin so the operator can always stop. Wrap in
  // try/catch - not all environments give a TTY.
  try {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onKey);
  } catch {
    // no stdin - skip
  }

  return lock;
}
