import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ storageState: "/Users/karthiknaig/Projects/ux-flow-tester/data/projects/lazy-dist/discovery/storage-state/session.json", viewport: { width: 1440, height: 860 } });
const page = await ctx.newPage();
const out = "/Users/karthiknaig/Projects/ux-flow-tester/data/tmp-ld-slides";
const base = "http://localhost:3100";
const shots = [["machine","/machine"],["queue","/queue"]];
let ok = 0;
for (const [name, p] of shots) {
  const url = `${base}/[project]${p}`.replace("/[project]","/lumen");
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
  await page.waitForTimeout(1800);
  const final = page.url();
  if (final.includes("/login") || final.includes("/sign-in")) { console.log("R", name, "-> auth redirect"); continue; }
  console.log("OK", name, "->", final);
  await page.screenshot({ path: path.join(out, `ui-${name}.png`) });
  ok++;
}
// studio new - the flagship editor
const url = `${base}/lumen/studio/new`;
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
await page.waitForTimeout(2000);
if (!page.url().includes("sign-in")) { await page.screenshot({ path: path.join(out, "ui-studio.png") }); console.log("OK studio"); ok++; }
await browser.close();
console.log("captured", ok);
