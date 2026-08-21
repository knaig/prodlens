// Core web adapter - the built-in adapter for any web product. Provides
// browser.* primitives (goto/click/fill/type/scroll/screenshot), http.*
// primitives (call an endpoint, capture the response), and the flow /
// architecture scene types that work on any discovered product.
import { localChat } from "../llm/local.js";
import { osHumanClick, osType, viewportToScreen } from "../execution/os-cursor.js";
import type {
  CapturedArtifact,
  PrimitiveContext,
  PrimitiveInvocation,
  PrimitiveResult,
  ProdlensAdapter,
  ProductSurface,
  ResourceNeed,
  ResourceResolution,
} from "./types.js";
import { registerAdapter } from "./engine.js";

function isWebApp(surface: ProductSurface): boolean {
  return Boolean(surface.graph || surface.screenshots || surface.description || surface.docs);
}

/** Find the base URL: manifest first, then surface, then default. */
function baseUrl(ctx: PrimitiveContext): string {
  const b = (ctx.manifest?.surfaces as { baseUrl?: string } | undefined)?.baseUrl;
  if (b) return b.replace(/\/$/, "");
  return "http://localhost:3000";
}

/** Read current page content (for narration / screenshots). */
async function shot(page: import("playwright").Page, workDir: string, label: string): Promise<CapturedArtifact> {
  const path = `${workDir}/${label}.png`;
  await page.screenshot({ path, fullPage: false }).catch(() => null);
  return { kind: "screenshot", path, label };
}

export const coreWebAdapter: ProdlensAdapter = {
  id: "web",
  name: "Web app (core)",
  detect: isWebApp,

  manifestFields: [
    { key: "surfaces.baseUrl", type: "string", description: "App base URL", required: true },
    { key: "surfaces.endpoints", type: "record", description: "REST endpoints {name,method,path,auth}" },
    { key: "entry", type: "string", description: "Entry path, e.g. /" },
  ],

  sceneTypes: [
    {
      id: "persona",
      description: "A persona intro card: who the demo is for, the problem, and the goal. Opens a persona-driven walkthrough.",
      fields: [
        { key: "name", type: "string", description: "Persona name", required: true },
        { key: "problem", type: "string", description: "The problem they face", required: true },
        { key: "goal", type: "string", description: "What they want to accomplish", required: true },
      ],
    },
    {
      id: "ux",
      description: "A screen-by-screen walkthrough scene: goto/click a screen, narrate what it is.",
      fields: [
        { key: "path", type: "string", description: "Route path", required: true },
        { key: "click", type: "string", description: "Optional label to click to reach the screen" },
      ],
    },
    {
      id: "flow",
      description: "A single-core-flow diagram scene: shows the product's core user flow as a diagram.",
      fields: [
        { key: "title", type: "string", description: "Flow title", required: true },
        { key: "steps", type: "string[]", description: "Core flow step labels in order" },
      ],
    },
    {
      id: "architecture",
      description: "A component/architecture scene: what the product is built from and why.",
      fields: [
        { key: "title", type: "string", description: "Component title", required: true },
        { key: "components", type: "string[]", description: "Component names" },
      ],
    },
  ],

  primitives: [
    { op: "persona.set", description: "Define the persona for an intro card (rendered as a slide, no browser action).", args: [{ key: "name", type: "string", description: "Persona name", required: true }, { key: "role", type: "string", description: "Role/title" }, { key: "problem", type: "string", description: "The problem" }, { key: "goal", type: "string", description: "The goal" }] },
    { op: "browser.goto", description: "Navigate to a path (relative to baseUrl).", args: [{ key: "path", type: "string", description: "Route path", required: true }] },
    { op: "browser.click", description: "Click an element by visible label.", args: [{ key: "label", type: "string", description: "Visible text", required: true }] },
    { op: "browser.fill", description: "Fill a form field by selector.", args: [{ key: "selector", type: "string", description: "CSS selector", required: true }, { key: "value", type: "string", description: "Value", required: true }] },
    { op: "browser.type", description: "Type text into the focused field.", args: [{ key: "text", type: "string", description: "Text", required: true }] },
    { op: "browser.scroll", description: "Scroll the page (tour/down).", args: [{ key: "mode", type: "string", description: "tour|down" }] },
    { op: "browser.screenshot", description: "Capture a screenshot artifact.", args: [{ key: "label", type: "string", description: "Artifact label" }] },
    { op: "http.call", description: "Call an endpoint, capture the JSON response.", args: [{ key: "method", type: "string", description: "GET|POST|PUT|DELETE" }, { key: "path", type: "string", description: "Endpoint path", required: true }, { key: "body", type: "string", description: "JSON body for POST/PUT" }] },
  ],

  async resolveResource(need: ResourceNeed, surface: ProductSurface): Promise<ResourceResolution> {
    // Generic resolution: look in docs for how to obtain, else source.
    const term = need.resource.toLowerCase();
    if (surface.docs) {
      const hit = surface.docs.find((d) => d.toLowerCase().includes(term));
      if (hit) return { status: "obtainable", how: `Documented in: ${hit}. Check that file for setup instructions.` };
    }
    if (surface.source) {
      const hit = surface.source.find((s) => s.toLowerCase().includes(term));
      if (hit) return { status: "obtainable", how: `Referenced in source: ${hit}. Check its config/env parsing.` };
    }
    return { status: "blocked", neededFromUser: `${need.resource} (${need.purpose}) - supply a value or credentials.` };
  },

  async execute(primitive: PrimitiveInvocation, ctx: PrimitiveContext): Promise<PrimitiveResult> {
    const { op, args } = primitive;
    const page = ctx.page!;
    const b = baseUrl(ctx);

    switch (op) {
      case "persona.set": {
        // No browser action - the walkthrough renderer turns this into a
        // persona intro slide from the args.
        return { ok: true };
      }
      case "browser.goto": {
        await page.goto(`${b}${args.path as string}`, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
        await page.waitForTimeout(800);
        return { ok: true };
      }
      case "browser.click": {
        const label = args.label as string;
        let target: import("playwright").Locator | undefined;
        const byLink = page.getByRole("link", { name: label, exact: true }).first();
        if (await byLink.isVisible().catch(() => false)) target = byLink;
        else {
          const byButton = page.getByRole("button", { name: label, exact: true }).first();
          if (await byButton.isVisible().catch(() => false)) target = byButton;
          else target = page.getByText(label, { exact: false }).first();
        }
        const box = await target?.boundingBox().catch(() => null);
        if (box && ctx.osCursor) {
          // Drive the REAL cursor to the element center, then click.
          const s = viewportToScreen(ctx.osCursor.geom, box.x + box.width / 2, box.y + box.height / 2);
          await osHumanClick(s.x, s.y);
        } else if (target) {
          await target.click({ timeout: 2500 });
        }
        await page.waitForTimeout(800);
        return { ok: true };
      }
      case "browser.fill": {
        const locator = page.locator(args.selector as string).first();
        const box = await locator.boundingBox().catch(() => null);
        if (box && ctx.osCursor) {
          const s = viewportToScreen(ctx.osCursor.geom, box.x + box.width / 2, box.y + box.height / 2);
          await osHumanClick(s.x, s.y);
          await osType(page, args.value as string);
        } else {
          await locator.fill(args.value as string, { timeout: 2500 }).catch(() => null);
        }
        return { ok: true };
      }
      case "browser.type": {
        await page.keyboard.type(args.text as string, { delay: 45 });
        return { ok: true };
      }
      case "browser.scroll": {
        const mode = (args.mode as string) ?? "tour";
        const maxY = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight).catch(() => 0);
        const step = 320;
        for (let y = 0; y < maxY - 20; y += step) {
          await page.mouse.wheel(0, step);
          await page.waitForTimeout(60);
        }
        await page.waitForTimeout(250);
        if (mode === "tour") {
          for (let y = maxY; y > 0; y -= step) {
            await page.mouse.wheel(0, -step);
            await page.waitForTimeout(60);
          }
        }
        return { ok: true };
      }
      case "browser.screenshot": {
        return { ok: true, artifacts: [await shot(page, ctx.workDir, (args.label as string) ?? "screen")] };
      }
      case "http.call": {
        const method = (args.method as string) ?? "GET";
        const url = args.path as string;
        const target = /^https?:/.test(url) ? url : `${b}${url}`;
        const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
        if (args.body) init.body = JSON.stringify(args.body);
        const resp = await fetch(target, init).catch((e) => null);
        const body = resp ? await resp.text().catch(() => "") : "";
        const path = `${ctx.workDir}/http-${Date.now()}.json`;
        const { writeFileSync } = await import("node:fs");
        writeFileSync(path, body || JSON.stringify({ status: resp?.status ?? 0 }));
        return { ok: true, artifacts: [{ kind: "json", path, label: `${method} ${url}` }] };
      }
      default:
        return { ok: false, error: `Unknown primitive op: ${op}` };
    }
  },
};

registerAdapter(coreWebAdapter);
