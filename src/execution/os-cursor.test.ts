// Spec: v2 §4 (PM1) - see spec/traceability.md
// The overlay cursor is what a viewer sees in every recorded demo, so its
// continuity across navigation is a product property, not a detail.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { addCursorOverlay } from "./os-cursor.js";

async function withOverlayPage<T>(fn: (page: import("playwright").Page, pos: () => Promise<string | null>) => Promise<T>): Promise<T> {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    await addCursorOverlay(ctx);
    const page = await ctx.newPage();
    // Serve every URL locally so navigation stays same-origin, as a real demo's does.
    await page.route("**/*", (r) => r.fulfill({ contentType: "text/html", body: "<h1>page</h1>" }));
    const pos = () =>
      page.evaluate(`(() => { const e = document.getElementById('prodlens-cursor');
        return e ? e.style.left + '/' + e.style.top : null; })()`) as Promise<string | null>;
    return await fn(page, pos);
  } finally {
    await browser.close();
  }
}

describe("cursor overlay", () => {
  test("starts at the viewport centre, not the corner", async () => {
    // It used to initialise at 0,0 and only move on mousemove, so a scene that
    // only navigated left the pointer parked in the top-left for its whole
    // duration.
    await withOverlayPage(async (page, pos) => {
      await page.goto("http://localhost:9/a");
      const p = await pos();
      assert.ok(p, "overlay should exist");
      assert.notEqual(p, "0px/0px", "must not park in the corner");
      const [x, y] = p.split("/").map((v) => parseInt(v, 10));
      assert.ok(x > 100 && y > 100, `expected a centred start, got ${p}`);
    });
  });

  test("keeps its position across a navigation", async () => {
    // The overlay is re-injected on every navigation. Without persistence it
    // reset to its start position, so the recording showed the pointer snap
    // away and then teleport back to the next target - the jumping cursor.
    await withOverlayPage(async (page, pos) => {
      await page.goto("http://localhost:9/a");
      await page.mouse.move(400, 300, { steps: 10 });
      assert.equal(await pos(), "400px/300px");
      await page.goto("http://localhost:9/b");
      assert.equal(await pos(), "400px/300px", "position must survive navigation");
    });
  });

  test("follows the mouse", async () => {
    await withOverlayPage(async (page, pos) => {
      await page.goto("http://localhost:9/a");
      await page.mouse.move(120, 140, { steps: 5 });
      assert.equal(await pos(), "120px/140px");
    });
  });
});
