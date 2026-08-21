// Browser tool registry for the agent loop (dsh tools analogue). A tool is a
// Playwright page action with a model-facing description and a canonical JSON
// result. The loop forces one "choose_action" decision against the model, then
// executes the chosen tool here (see loop.ts). Each tool observes exec.signal
// so timed-out or cancelled steps reach quiescence.
import type { Page } from "playwright";

export interface ToolArgs {
  [key: string]: unknown;
}

export interface ToolResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

export interface BrowserTool {
  name: string;
  description: string;
  /** JSON-serializable argument schema for model-facing candidate building. */
  argSchema: Record<string, string>;
  /** Run the action. Must not throw: failures return { ok: false }. */
  run(page: Page, args: ToolArgs, opts: { timeoutMs: number; signal?: AbortSignal; baseUrl?: string }): Promise<ToolResult>;
}

const DEFAULT_TIMEOUT = 8000;

export const browserTools: BrowserTool[] = [
  {
    name: "navigate",
    description: "Navigate to the given absolute or app-relative URL. Use for entry points and link targets.",
    argSchema: { url: "string" },
    async run(page, args, opts) {
      const url = String(args.url ?? "");
      if (!url) return { ok: false, error: "navigate requires a url" };
      const target = new URL(url, opts.baseUrl ?? "http://localhost").toString();
      const nav = await page.goto(target, { waitUntil: "domcontentloaded", timeout: opts.timeoutMs, signal: opts.signal });
      if (!nav) return { ok: false, error: `navigation to "${url}" failed` };
      return { ok: true, value: page.url() };
    },
  },
  {
    name: "click_label",
    description: "Click the first visible element whose accessible name or text exactly matches the label.",
    argSchema: { label: "string" },
    async run(page, args, opts) {
      const label = String(args.label ?? "");
      const byLink = page.getByRole("link", { name: label, exact: true }).first();
      if (await byLink.isVisible().catch(() => false)) {
        await byLink.click({ timeout: opts.timeoutMs });
        return { ok: true, value: label };
      }
      const byButton = page.getByRole("button", { name: label, exact: true }).first();
      if (await byButton.isVisible().catch(() => false)) {
        await byButton.click({ timeout: opts.timeoutMs });
        return { ok: true, value: label };
      }
      await page.getByText(label, { exact: true }).first().click({ timeout: opts.timeoutMs });
      return { ok: true, value: label };
    },
  },
  {
    name: "click_selector",
    description: "Click the element matching a Playwright CSS selector (used for heavyweight or structural steps).",
    argSchema: { selector: "string" },
    async run(page, args, opts) {
      const selector = String(args.selector ?? "");
      if (!selector) return { ok: false, error: "click_selector requires a selector" };
      await page.locator(selector).first().click({ timeout: opts.timeoutMs });
      return { ok: true, value: selector };
    },
  },
  {
    name: "type",
    description: "Fill a form field identified by CSS selector with a value.",
    argSchema: { selector: "string", value: "string" },
    async run(page, args, opts) {
      const selector = String(args.selector ?? "");
      const value = String(args.value ?? "");
      const locator = page.locator(selector).first();
      await locator.fill(value, { timeout: opts.timeoutMs });
      return { ok: true, value: selector };
    },
  },
  {
    name: "select",
    description: "Select an option in a <select> by value.",
    argSchema: { selector: "string", value: "string" },
    async run(page, args, opts) {
      const selector = String(args.selector ?? "");
      const value = String(args.value ?? "");
      await page.locator(selector).first().selectOption(value, { timeout: opts.timeoutMs });
      return { ok: true, value: selector };
    },
  },
  {
    name: "go_back",
    description: "Navigate back one browser history entry (used to recover from dead ends).",
    argSchema: {},
    async run(page, _args, opts) {
      await page.goBack({ timeout: opts.timeoutMs });
      return { ok: true, value: page.url() };
    },
  },
  {
    name: "screenshot",
    description: "Capture the current viewport to the given file path.",
    argSchema: { path: "string" },
    async run(page, args, opts) {
      const path = String(args.path ?? "");
      if (!path) return { ok: false, error: "screenshot requires a path" };
      await page.screenshot({ path, fullPage: false });
      return { ok: true, value: path };
    },
  },
];

export function getBrowserTool(name: string): BrowserTool | undefined {
  return browserTools.find((t) => t.name === name);
}

export async function runBrowserTool(
  tool: BrowserTool,
  page: Page,
  args: ToolArgs,
  opts: { timeoutMs?: number; signal?: AbortSignal; baseUrl?: string }
): Promise<ToolResult> {
  try {
    const result = await tool.run(page, args, { timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT, signal: opts.signal, baseUrl: opts.baseUrl });
    return {
      ok: result.ok,
      value: result.value,
      error: result.error ?? (result.ok ? undefined : "tool failed"),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}