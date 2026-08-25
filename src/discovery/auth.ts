// Spec: NFR-2, v2 §8 - see spec/traceability.md
// Auth handling for the live crawler. "Log in once per portal": a session is
// established once and cached to disk via Playwright's storageState, reused
// across every subsequent run until it's proven stale.
//
// Three strategies:
//   - "password": plain email/password form login against the app's real
//     sign-in form. No Clerk testing-token machinery (no @clerk/testing), no
//     bot-check bypass - it's exactly what a human types. Clerk's "new
//     device" email verification step is handled via the +clerk_test fixed
//     code 424242 when the account uses that convention.
//   - "clerk-password": the legacy path - uses @clerk/testing to bypass
//     Cloudflare/bot checks first, then fills the same form. Only needed
//     when the app gates sign-in behind a captcha (e.g. sign-up forms); the
//     plain "password" strategy is preferred whenever it works.
//   - "clerk-signup": self-service registration for demo/product runs - the
//     tool creates a brand-new test account on the fly (fresh email via the
//     +clerk_test convention + generated password), fills Clerk's sign-up
//     form, handles the email-verification code, and caches the session like
//     any other strategy. The generated credentials are written next to the
//     storageState so you know what account the run used.
//
// The plain strategy is what should be used for normal runs - it produces a
// real session that survives storageState reuse, instead of the testing-token
// session that goes stale.
import { existsSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Browser, BrowserContext, Locator, Page } from "playwright";
import { clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";

export interface AuthConfig {
  strategy: "none" | "password" | "clerk-password" | "clerk-signup" | "custom-login";
  baseUrl: string;
  signInPath?: string;
  /** Sign-up route for the "clerk-signup" strategy (defaults to /sign-up). */
  signUpPath?: string;
  /** A route known to require auth. Session validation navigates here - if it
   *  bounces to the sign-in page, the cached session is stale and we re-login.
   *  Defaults to "/", which is often public; pass the app's real entry path
   *  (e.g. "/lazy-dist-mslieorh") so staleness is actually detected. */
  protectedPath?: string;
  email?: string;
  password?: string;
  storageStatePath: string;
  /** For "custom-login": after filling email/password, click a button matching
   *  this selector or role name (default: /sign in|login/i). */
  loginButton?: string;
  /** For "custom-login": true if the app's auth token lives in localStorage
   *  (e.g. `access_token`) rather than a cookie. storageState then persists the
   *  localStorage so the session survives context reuse. */
  localStorageToken?: boolean;
}

export interface AuthContextOptions {
  /** Plays through to browser.newContext so the returned context records video. */
  recordVideo?: { dir: string; size?: { width: number; height: number } };
}

let clerkSetupDone = false;

export async function getAuthedContext(browser: Browser, config: AuthConfig, opts: AuthContextOptions = {}): Promise<BrowserContext> {
  const contextOpts = () => ({ recordVideo: opts.recordVideo });

  if (config.strategy === "none") return browser.newContext(contextOpts());

  if (existsSync(config.storageStatePath)) {
    const context = await browser.newContext({ storageState: config.storageStatePath, ...contextOpts() });
    if (await sessionStillValid(context, config)) return context;
    await context.close();
  }

  if (config.strategy === "clerk-password" && !clerkSetupDone) {
    await clerkSetup();
    clerkSetupDone = true;
  }
  const context = await browser.newContext(contextOpts());
  if (config.strategy === "clerk-signup") {
    await performSignup(context, config);
  } else if (config.strategy === "custom-login") {
    await performCustomLogin(context, config);
  } else {
    await performPasswordLogin(context, config);
  }
  mkdirSync(dirname(config.storageStatePath), { recursive: true });
  await context.storageState({ path: config.storageStatePath });
  return context;
}

async function sessionStillValid(context: BrowserContext, config: AuthConfig): Promise<boolean> {
  const page = await context.newPage();
  try {
    const protectedPath = config.protectedPath ?? "/";
    await page.goto(`${config.baseUrl}${protectedPath}`, { waitUntil: "domcontentloaded", timeout: 15000 });
    // Let the app settle: an expired-token app often renders the protected
    // route shell at domcontentloaded, then redirects to / after the first
    // authed API call fails. Wait long enough for that redirect to happen.
    await page.waitForTimeout(2500);
    const url = page.url();
    // Signed out => we get bounced to the sign-in page (app-local or hosted
    // Clerk portal). Signed in => the protected route renders at its own URL.
    if (url.includes("/sign-in") || url.includes("/sign-up") || url.includes("/login")) return false;
    // Some apps redirect a dead session to "/" (their login page) instead of
    // "/login". If the final pathname no longer matches the protected path, the
    // session is gone - don't trust a leftover localStorage token.
    const finalPath = new URL(url).pathname.replace(/\/+$/, "");
    const wantPath = protectedPath.replace(/\/+$/, "");
    if (finalPath !== wantPath) return false;
    // localStorage-backed sessions: confirm the token is actually present,
    // otherwise a page that renders for logged-out users would pass the URL check.
    if (config.localStorageToken) {
      const token = await page.evaluate(() => localStorage.getItem("access_token")).catch(() => null);
      if (!token) return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    await page.close();
  }
}

async function performPasswordLogin(context: BrowserContext, config: AuthConfig): Promise<void> {
  if (!config.email || !config.password) {
    throw new Error(
      "No cached session and no test credentials provided - cannot log in. " +
        "Create a test account in the target app and set UX_FLOW_TEST_EMAIL / UX_FLOW_TEST_PASSWORD."
    );
  }
  const email = config.email;
  const password = config.password;
  const page = await context.newPage();
  if (config.strategy === "clerk-password") {
    await setupClerkTestingToken({ page });
  }
  await page.goto(`${config.baseUrl}${config.signInPath ?? "/sign-in"}`, { waitUntil: "domcontentloaded" });

  // Clerk's sign-in form uses identifier/password fields; some themes label
  // them "Email address"/"Password", so match by field id first, label second.
  await page.locator("#identifier-field, input[name='identifier']").first().fill(email).catch(async () => {
    await page.getByLabel(/email/i).first().fill(email);
  });
  const continueAfterEmail = page.getByRole("button", { name: "Continue", exact: true }).first();
  if (await continueAfterEmail.isVisible().catch(() => false)) await continueAfterEmail.click();

  await page.locator("#password-field, input[name='password']").first().fill(password).catch(async () => {
    await page.getByLabel(/password/i).first().fill(password);
  });
  const submitPassword = page.getByRole("button", { name: "Continue", exact: true }).first();
  if (await submitPassword.isVisible().catch(() => false)) {
    await submitPassword.click();
  } else {
    await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
  }

  // Clerk challenges any never-seen-before browser context with a "new
  // device" email verification step. If the account's email uses Clerk's
  // documented "+clerk_test" convention, the fixed code 424242 always
  // verifies it, with no real inbox needed. fill() waits (retries until the
  // element is actionable), so its timeout is the real wait for the code
  // screen to appear after the password submit. The session cookie is set by
  // the code submission even though the page URL may linger on
  // /sign-in/client-trust - so don't waitForURL away from /sign-in (it can
  // hang there); instead confirm the session by navigating to the protected
  // route and checking we aren't bounced back to sign-in.
  const codeInput = page.locator('input[name="code"], input[autocomplete="one-time-code"]').first();
  const codeAppeared = await codeInput
    .fill("424242", { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (codeAppeared && !config.email.includes("+clerk_test")) {
    throw new Error(
      'Clerk is asking for a "new device" email verification code, and the test email does not use the ' +
        "+clerk_test convention (e.g. name+clerk_test@example.com) that gets the fixed code 424242. " +
        "Recreate the test account with that email pattern."
    );
  }
  await page.waitForTimeout(3000); // let Clerk's JS process the code submission

  const verifyPath = config.protectedPath ?? "/";
  await page.goto(`${config.baseUrl}${verifyPath}`, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
  await page.waitForTimeout(2000);
  if (page.url().includes("/sign-in")) {
    throw new Error(`Login did not establish a session (still redirected to sign-in at ${page.url()}).`);
  }
  await page.close();
}

/** Self-service registration for the demo/run pipelines: creates a brand-new
 *  test account on the fly and verifies it, so a product demo needs no
 *  pre-provisioned credentials. Requires the app to use Clerk's +clerk_test
 *  email convention (fixed verification code 424242 - no real inbox needed).
 *  The generated credentials are written to a JSON file next to the
 *  storageState so callers/operators can see which account was created. */
async function performSignup(context: BrowserContext, config: AuthConfig): Promise<void> {
  await clerkSetup();
  const ts = Date.now();
  // If an email was passed in, it must already use the +clerk_test convention
  // (fixed code 424242); otherwise generate a fresh test address.
  const email =
    config.email && config.email.includes("+clerk_test")
      ? config.email
      : config.email && !config.email.includes("+clerk_test")
        ? config.email.replace("@", `+clerk_test@`)
        : `uft-demo-${ts}@example.com`.replace("@", `+clerk_test@`);
  const verifiedEmail = email;
  const password = config.password ?? `Demo!${ts % 100000000}`;

  const page = await context.newPage();
  await setupClerkTestingToken({ page });
  await page.goto(`${config.baseUrl}${config.signUpPath ?? "/sign-up"}`, { waitUntil: "domcontentloaded", timeout: 20000 });

  // Clerk's sign-up form fields. Names are stable across themes; fill by id
  // first, fall back to label matching.
  const fillField = async (idPattern: string, value: string) => {
    await page
      .locator(idPattern)
      .first()
      .fill(value, { timeout: 8000 })
      .catch(async () => {
        await page.getByLabel(/first name/i).first().fill(value).catch(() => null);
      });
  };
  await fillField("#firstName-field", "Demo");
  await fillField("#lastName-field", "Runner");
  await fillField("#emailAddress-field, #identifier-field, input[name='emailAddress']", verifiedEmail);
  await fillField("#password-field, input[name='password']", password);

  const submit = page
    .getByRole("button", { name: /^(create account|continue|sign up|register)$/i, exact: true })
    .first();
  await submit.click({ timeout: 8000 }).catch(async () => {
    await page.getByRole("button", { name: /create account|sign up/i }).first().click({ timeout: 8000 });
  });

  // Clerk may require email verification for a brand-new signup. The
  // +clerk_test convention yields the fixed code 424242.
  const codeInput = page.locator('input[name="code"], input[autocomplete="one-time-code"]').first();
  const codeAppeared = await codeInput
    .fill("424242", { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (codeAppeared) {
    await page
      .getByRole("button", { name: /^(continue|verify|submit)$/i, exact: true })
      .first()
      .click({ timeout: 8000 })
      .catch(() => null);
  }

  // Wait for the session cookie to actually exist (up to 15s) instead of a
  // fixed sleep - Clerk's post-verification redirect and session creation can
  // take a variable amount of time, and navigating before it lands bounces to
  // sign-in. The __session cookie is httpOnly, so it must be checked via
  // context.cookies(), not document.cookie inside the page.
  let sessionCookieReady = false;
  for (let i = 0; i < 15; i++) {
    const cookies = await context.cookies().catch(() => [] as { name: string }[]);
    if (cookies.some((c) => c.name.startsWith("__session"))) {
      sessionCookieReady = true;
      break;
    }
    await page.waitForTimeout(1000);
  }

  const verifyPath = config.protectedPath ?? "/";
  await page.goto(`${config.baseUrl}${verifyPath}`, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
  await page.waitForTimeout(2000);
  if (!sessionCookieReady || page.url().includes("/sign-in") || page.url().includes("/sign-up")) {
    throw new Error(
      `Signup did not establish a session (still on auth flow at ${page.url()}, session cookie ${sessionCookieReady ? "set" : "absent"}). ` +
        "If the app needs a real email verification, the +clerk_test convention must be supported."
    );
  }

  // Persist the credentials alongside the storageState so the account is
  // discoverable after the run.
  try {
    mkdirSync(dirname(config.storageStatePath), { recursive: true });
    writeFileSync(
      join(dirname(config.storageStatePath), "demo-credentials.json"),
      JSON.stringify({ email: verifiedEmail, password, createdAt: new Date().toISOString() }, null, 2)
    );
  } catch {
    // credentials file is a convenience - never fail the run over it
  }
  await page.close();
}

/** Fill a field the way a real user would (click, keyboard-type), then verify
 *  the value actually stuck before moving on. A plain .fill() sets the DOM
 *  value directly - if React finishes hydrating a moment later, it reconciles
 *  the controlled input back to its pre-fill (empty) state and the typed
 *  value silently vanishes. Fine on an instant local dev server; a real
 *  deployed app's hydration can lag enough for this to bite (confirmed live:
 *  the password field kept its value, the email field above it didn't).
 *  Falls back to a networkidle-gated .fill() (fires real input events post-
 *  hydration) if the keyboard type didn't take. */
async function fillHydrationSafe(page: Page, locator: Locator, value: string): Promise<void> {
  await locator.click({ timeout: 8000 }).catch(() => null);
  await locator.focus().catch(() => null);
  await page.keyboard.type(value, { delay: 30 }).catch(() => null);
  const got = await locator.inputValue().catch(() => null);
  if (got !== value) {
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => null);
    await locator.fill(value, { timeout: 4000 }).catch(() => null);
  }
}

/** Generic UI login for apps with their own auth (JWT in localStorage, no
 *  Clerk): fill email/password on the sign-in page, click the submit button,
 *  and wait for the session to establish. Works for any app whose sign-in is a
 *  plain form - the storageState (cookies + localStorage) is what's cached, so
 *  the session survives context reuse. */
async function performCustomLogin(context: BrowserContext, config: AuthConfig): Promise<void> {
  if (!config.email || !config.password) {
    throw new Error(
      "custom-login needs UX_FLOW_TEST_EMAIL / UX_FLOW_TEST_PASSWORD set to the app's own account."
    );
  }
  const email: string = config.email;
  const password: string = config.password;
  const page = await context.newPage();
  await page.goto(`${config.baseUrl}${config.signInPath ?? "/"}`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(1200);

  // Clear any stale token from a previous session in this context - otherwise
  // the "token present?" check below passes with the OLD token before the login
  // actually completes, and we'd cache a dead session.
  if (config.localStorageToken) {
    await page.evaluate(() => {
      localStorage.removeItem("access_token");
      localStorage.removeItem("org_id");
      localStorage.removeItem("email");
    }).catch(() => null);
  }

  // Email field: id/name first, then type=email, then label. Fill is
  // hydration-safe (see fillHydrationSafe) - a plain .fill() can lose its
  // value if the framework finishes hydrating a moment after the fill, which
  // reconciles the controlled input back to its initial empty state. Fine on
  // an instant local dev server; a real deployed app's hydration can lag
  // enough for this to bite (confirmed live: password stuck, email didn't).
  const emailLocator = page.locator("#email, #emailAddress, #identifier-field, input[name='email'], input[type='email']").first();
  if (await emailLocator.count()) await fillHydrationSafe(page, emailLocator, email);
  else await fillHydrationSafe(page, page.getByLabel(/email/i).first(), email);
  // Password field.
  const passwordLocator = page.locator("#password, #password-field, input[name='password'], input[type='password']").first();
  if (await passwordLocator.count()) await fillHydrationSafe(page, passwordLocator, password);
  else await fillHydrationSafe(page, page.getByLabel(/password/i).first(), password);

  // Submit: a button with an explicit loginButton selector, else role name.
  if (config.loginButton) {
    await page.locator(config.loginButton).first().click({ timeout: 8000 }).catch(() => null);
  } else {
    await page
      .getByRole("button", { name: /sign in|login|log in/i })
      .first()
      .click({ timeout: 8000 })
      .catch(async () => {
        await page.getByRole("button", { name: /continue/i }).first().click({ timeout: 8000 }).catch(() => null);
      });
  }

  // Wait for the session to establish: either a cookie (__session-like or any
  // auth cookie) or a localStorage token, then confirm we left the login page.
  const verifyPath = config.protectedPath ?? "/";
  const waitMs = 15000;
  let established = false;
  for (let i = 0; i < waitMs / 1000; i++) {
    const inLogin = page.url().includes("/sign-in") || page.url().includes("/login");
    const cookies = await context.cookies().catch(() => [] as { name: string }[]);
    const hasAuthCookie = cookies.some((c) => /token|session|auth/i.test(c.name));
    const hasLocalToken = config.localStorageToken
      ? await page.evaluate(() => !!localStorage.getItem("access_token")).catch(() => false)
      : false;
    if (!inLogin && (hasAuthCookie || hasLocalToken || config.localStorageToken === undefined)) {
      established = true;
      break;
    }
    await page.waitForTimeout(1000);
  }

  await page.goto(`${config.baseUrl}${verifyPath}`, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
  await page.waitForTimeout(1500);
  const stillLogin = page.url().includes("/sign-in") || page.url().includes("/login");
  if (!established || stillLogin) {
    throw new Error(
      `Custom login did not establish a session (still on auth flow at ${page.url()}). ` +
        "Check UX_FLOW_TEST_EMAIL/PASSWORD, the login field selectors, and whether the app stores auth in localStorage."
    );
  }
  await page.close();
}
