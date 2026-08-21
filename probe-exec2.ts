import { chromium } from "playwright";
import { getAuthedContext } from "./src/discovery/auth.ts";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const auth = {
    strategy: "password" as const,
    baseUrl: "http://localhost:3101",
    protectedPath: "/lazy-dist-mslieorh",
    email: process.env.UX_FLOW_TEST_EMAIL!,
    password: process.env.UX_FLOW_TEST_PASSWORD!,
    storageStatePath: "/tmp/probe-fresh-session.json",
  };
  const c1 = await getAuthedContext(browser, auth);
  const page = await c1.newPage();
  await page.goto("http://localhost:3101/lazy-dist-mslieorh", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(2000);
  console.log("start node:", page.url());

  for (const target of ["/projects", "/lazy-dist-mslieorh/queue"]) {
    const t0 = Date.now();
    const nav = await page.goto("http://localhost:3101" + target, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
    await page.waitForTimeout(2500);
    console.log(target, "-> nav:", !!nav, "| elapsed:", ((Date.now() - t0) / 1000).toFixed(1) + "s", "| url:", page.url());
  }
  await browser.close();
}

main().catch((e) => {
  console.error("ERR:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
