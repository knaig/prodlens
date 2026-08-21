import { chromium } from "playwright";

async function main() {
  const email = process.env.UX_FLOW_TEST_EMAIL!;
  const password = process.env.UX_FLOW_TEST_PASSWORD!;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("http://localhost:3101/sign-in", { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(3000);
  await page.locator("#identifier-field").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).first().click();
  await page.waitForTimeout(2500);
  await page.locator("#password-field").fill(password);
  await page.getByRole("button", { name: "Continue", exact: true }).first().click();
  await page.waitForTimeout(4000);
  console.log("at:", page.url());

  const codeInput = page.locator('input[name="code"], input[autocomplete="one-time-code"]').first();
  await codeInput.fill("424242");
  await page.waitForTimeout(5000);

  const cookies = await context.cookies("http://localhost:3101");
  const clerkCookie = cookies.find((c) => c.name === "__session");
  console.log("__session cookie after code:", clerkCookie ? "PRESENT (len " + clerkCookie.value.length + ")" : "absent");

  // Now try navigating to protected page directly
  await page.goto("http://localhost:3101/lazy-dist-mslieorh", { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
  await page.waitForTimeout(2500);
  console.log("after goto protected:", page.url());
  await browser.close();
}

main().catch((e) => {
  console.error("ERR:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
