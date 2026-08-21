import { chromium } from "playwright";

async function main() {
  const email = process.env.UX_FLOW_TEST_EMAIL!;
  const password = process.env.UX_FLOW_TEST_PASSWORD!;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("http://localhost:3101/sign-in", { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(3500);

  await page.locator("#identifier-field").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).first().click();
  await page.waitForTimeout(3000);
  console.log("after email:", page.url());

  await page.locator("#password-field").fill(password);
  await page.getByRole("button", { name: "Continue", exact: true }).first().click();
  await page.waitForTimeout(4000);
  console.log("after password:", page.url());

  const inputs = await page.$$eval("input", (els) => els.map((e) => ({ id: e.id, name: e.name, type: e.type }))).catch(() => []);
  console.log("inputs now:", JSON.stringify(inputs));
  const alerts = await page.$$eval("p, li, [role=alert]", (els) => els.map((e) => (e.textContent || "").trim()).filter(Boolean).slice(0, 6)).catch(() => []);
  console.log("alerts:", JSON.stringify(alerts));

  const codeInput = page.locator('input[name="code"], input[autocomplete="one-time-code"]').first();
  const codeVisible = await codeInput.isVisible().catch(() => false);
  console.log("code input visible:", codeVisible);
  if (codeVisible) {
    await codeInput.fill("424242");
    await page.waitForTimeout(3000);
    const cont = page.getByRole("button", { name: "Continue", exact: true }).first();
    if (await cont.isVisible().catch(() => false)) await cont.click();
    await page.waitForTimeout(4000);
    console.log("after code:", page.url());
    const alerts2 = await page.$$eval("p, li, [role=alert]", (els) => els.map((e) => (e.textContent || "").trim()).filter(Boolean).slice(0, 6)).catch(() => []);
    console.log("alerts after code:", JSON.stringify(alerts2));
  }
  await browser.close();
}

main().catch((e) => {
  console.error("ERR:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
