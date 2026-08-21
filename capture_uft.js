const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 860 } });
  const page = await context.newPage();
  const out = "/Users/karthiknaig/Projects/lazy-dist/uft-shots";
  fs.mkdirSync(out, { recursive: true });
  const base = "/Users/karthiknaig/Projects/ux-flow-tester/site";

  await page.goto("file://" + base + "/index.html", { waitUntil: "load", timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(out, "01-landing.png") });

  await page.goto("file://" + base + "/explorer.html", { waitUntil: "load", timeout: 20000 }).catch(() => null);
  await page.waitForTimeout(1200);
  const tabs = [["summary","Summary"],["graph","Graph"],["paths","Paths"]];
  for (let i = 0; i < tabs.length; i++) {
    const [name, label] = tabs[i];
    const btn = page.locator(`button:has-text("${label}")`).first();
    await btn.click({ timeout: 5000 }).catch(() => null);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(out, `0${i + 2}-${name}.png`) });
  }
  await page.locator('button:has-text("Issues")').first().click({ timeout: 5000 }).catch(() => null);
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(out, "05-issues.png") });
  await page.locator('button:has-text("Projects")').first().click({ timeout: 5000 }).catch(() => null);
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(out, "06-projects.png") });

  await browser.close();
  console.log("done");
})().catch(e => { console.error(e); process.exit(1); });
