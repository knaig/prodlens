// Adapter synthesis: the LLM reads a product's repo (via ProductSurface,
// including key file contents) and generates a complete ProdlensAdapter module
// (ESM .mjs) that tells prodlens how to drive that product. This is the
// "code the SDK on the fly" capability - prodlens becomes product-agnostic by
// synthesizing, rather than requiring, a hand-written adapter per product.
//
// Flow: synthesize (LLM) -> write to target -> import+validate -> on failure,
// feed the error back to the LLM and retry (bounded). The generated module
// self-registers via registerAdapter() and extends the core web adapter.
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { localChat } from "../llm/local.js";
import type { ProductSurface } from "./types.js";

export interface SynthesisOptions {
  model?: string;
  /** Where to write the generated adapter (default derived from repoRoot). */
  outDir?: string;
  /** Max synthesis attempts. */
  attempts?: number;
}

/** The SDK import spec generated code uses. Defaults to the built dist entry
 *  via an absolute file URL so the generated module imports cleanly regardless
 *  of where it lives (a product repo). Override with PRODLENS_SDK_IMPORT. */
const SDK_IMPORT =
  process.env.PRODLENS_SDK_IMPORT ??
  pathToFileURL(join(process.cwd(), "dist", "adapters", "index.js")).href;

function describeFiles(surface: ProductSurface): string {
  const lines: string[] = [];
  for (const f of surface.fileContents ?? []) {
    lines.push(`### ${f.path}\n\`\`\`\n${f.content.slice(0, 3000)}\n\`\`\``);
  }
  for (const d of surface.docs ?? []) lines.push(`- doc: ${d}`);
  for (const s of surface.source ?? [].slice(0, 40)) lines.push(`- file: ${s}`);
  return lines.join("\n");
}

function buildPrompt(surface: ProductSurface): string {
  return (
    `You are generating a Prodlens adapter for a product. A ProdlensAdapter is a JavaScript module that ` +
    `teaches the prodlens demo/verification tool how to drive this product.\n\n` +
    `Write a single ESM module (.mjs) that:\n` +
    `1. imports { registerAdapter } from "${SDK_IMPORT}"\n` +
    `2. calls registerAdapter({ id, name, detect, manifestFields, sceneTypes, primitives, resolveResource, execute })\n\n` +
    `The module must export the adapter object as "default" AND call registerAdapter so prodlens picks it up.\n\n` +
    `Contract (TypeScript, types are erased at runtime - implement as plain JS):\n` +
    `- detect(surface: { graph?, source?, docs?, components?, fileContents?, description? }): boolean - true if this adapter can drive the product\n` +
    `- manifestFields: [{ key, type: "string"|"string[]"|"record"|"boolean", description, required? }]\n` +
    `- sceneTypes: [{ id, description, fields: [{key,type,description,required?}] }]\n` +
    `- primitives: [{ op, description, args: [{key,type,description,required?}] }]\n` +
    `- resolveResource(need: {id,resource,purpose}, surface): Promise<{status:"satisfied"|"obtainable"|"blocked", how?, neededFromUser?, value?}> - docs/source first, then "blocked" with what the user must supply\n` +
    `- execute(primitive: {op, args}, ctx: { page?, workDir, manifest, surface }): Promise<{ok, error?, artifacts?: [{kind:"screenshot"|"audio"|"json"|"log"|"text", path}]}>\n\n` +
    `Rules:\n` +
    `- If the product is a web app, your execute() should handle browser.* primitives (browser.goto/click/fill/type/scroll/screenshot) using ctx.page (a Playwright Page) - reuse the standard browser patterns.\n` +
    `- Add product-specific primitives for its real surfaces: REST endpoints (fetch), websocket/streams, CLI (child_process), files.\n` +
    `- Never propose destructive actions (delete/cancel/disconnect) as auto-executed primitives - return them as "blocked" resources if a scene needs them.\n` +
    `- Use only what the SDK provides: ctx.page (Playwright Page), ctx.workDir, ctx.manifest, ctx.surface. Node builtins (fs, path, child_process) are available.\n` +
    `- Write clean, dependency-free JS (only Playwright's Page is available via ctx.page).\n\n` +
    `=== PRODUCT REPO ===\n${describeFiles(surface)}\n\n` +
    `Output ONLY the JavaScript module code, no markdown fences, no prose.`
  );
}

/** Validate a generated adapter module by importing it in-process and running
 *  detect() against the surface. Returns the adapter object on success or
 *  throws the import/detect error. */
async function validateAdapterCode(code: string, filePath: string, surface: ProductSurface): Promise<{ id: string; name: string }> {
  writeFileSync(filePath, code);
  const mod = (await import(pathToFileURL(filePath).href)) as { default?: { id?: string; name?: string; detect?: (s: ProductSurface) => unknown } };
  const adapter = mod.default;
  if (!adapter || !adapter.id || !adapter.name) throw new Error(`Generated adapter missing default export with id/name (got ${JSON.stringify(adapter)}).`);
  // Run detect() so runtime errors in the generated code are surfaced and fed
  // back to the LLM on the next attempt, not discovered mid-walkthrough.
  if (typeof adapter.detect === "function") {
    try {
      adapter.detect(surface);
    } catch (e) {
      throw new Error(`Generated adapter.detect() threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { id: adapter.id, name: adapter.name };
}

/** Synthesize a ProdlensAdapter for the given product surface, writing it to
 *  `<outDir>/adapter.mjs` (default `<repoRoot>/prodlens/adapter.mjs`). Retries
 *  up to `attempts` times, feeding import errors back to the LLM. */
export async function synthesizeAdapter(surface: ProductSurface, opts: SynthesisOptions = {}): Promise<{ id: string; name: string; path: string }> {
  const model = opts.model ?? process.env.LLM_MANIFEST_MODEL ?? "qwen/qwen3-32b";
  const attempts = opts.attempts ?? 3;

  const outDir = opts.outDir;
  if (!outDir) throw new Error("synthesizeAdapter requires outDir (where to write adapter.mjs).");
  mkdirSync(outDir, { recursive: true });
  const target = join(outDir, "adapter.mjs");

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await localChat({
        system: "You generate Prodlens adapter modules as clean JavaScript.",
        text: buildPrompt(surface),
        maxTokens: 6000,
        temperature: 0.2,
        model,
      });
      if (res.error || !res.content) throw new Error(`Synthesis call failed: ${res.error ?? "empty response"}`);
      let code = res.content.trim();
      code = code.replace(/^```(?:js|javascript|mjs)?\s*/i, "").replace(/\s*```$/, "");
      if (!code.includes("registerAdapter(")) throw new Error("Generated module does not call registerAdapter().");

      // Write a temp file first for validation so we don't clobber a good
      // adapter with a bad attempt; promote on success. Must end in .mjs so
      // Node treats it as an ES module.
      const tmp = `${target}.${Date.now()}.tmp-${attempt}.mjs`;
      const meta = await validateAdapterCode(code, tmp, surface);
      rmSync(target, { force: true });
      writeFileSync(target, code);
      rmSync(tmp, { force: true });
      console.log(`Synthesized adapter "${meta.id}" (${meta.name}) -> ${target}`);
      return { id: meta.id, name: meta.name, path: target };
    } catch (e) {
      lastErr = e;
      console.warn(`[adapter-synthesis] attempt ${attempt}/${attempts} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`Adapter synthesis failed after ${attempts} attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

/** Load a synthesized adapter into the registry by importing its file. The
 *  module self-registers via registerAdapter() at import time. */
export async function loadSynthesizedAdapter(path: string): Promise<void> {
  await import(pathToFileURL(path).href);
}
