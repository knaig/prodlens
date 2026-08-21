// LLM manifest + walkthrough drafter. Given a product surface (graph, docs,
// source, components) and an adapter's schema (scene types + primitives), a
// text LLM (default qwen/qwen3-32b via OpenRouter, configurable) drafts:
//   - the product manifest (adapter-specific fields)
//   - a proposed walkthrough plan (scenes = narration + primitives + needs)
// The user reviews/edits this before anything is rendered.
import { localChat } from "../llm/local.js";
import type { ProductManifest, ProductSurface, ProdlensAdapter, SceneSpec, WalkthroughPlan } from "./types.js";

export interface DraftResult {
  manifest: ProductManifest;
  plan: WalkthroughPlan;
  /** Human-readable JSON of both, for the review form. */
  text: string;
}

function describeSurface(surface: ProductSurface): string {
  const lines: string[] = [];
  lines.push(`Description: ${surface.description ?? "n/a"}`);
  if (surface.graph) {
    const g = surface.graph as { nodes?: Record<string, unknown>; edges?: unknown[]; entryPoints?: string[] };
    lines.push(
      `Discovered graph: ${Object.keys(g.nodes ?? {}).length} screens, ${(g.edges ?? []).length} transitions, entries: ${(g.entryPoints ?? []).join(", ")}`
    );
    for (const id of Object.keys(g.nodes ?? {}).slice(0, 25)) lines.push(`  - screen ${id}`);
  }
  if (surface.docs?.length) {
    lines.push(`Docs available (${surface.docs.length}):`);
    for (const d of surface.docs.slice(0, 8)) lines.push(`  - ${d}`);
  }
  if (surface.source?.length) {
    lines.push(`Source available (${surface.source.length} files), e.g.:`);
    for (const s of surface.source.slice(0, 12)) lines.push(`  - ${s}`);
  }
  if (surface.components?.length) {
    lines.push("Components:");
    for (const c of surface.components.slice(0, 12)) lines.push(`  - ${c.name} (${c.path})${c.externalDeps?.length ? ` deps: ${c.externalDeps.join(", ")}` : ""}`);
  }
  return lines.join("\n");
}

function describeAdapter(adapter: ProdlensAdapter): string {
  const sceneTypes = adapter.sceneTypes.map((s) => `    - ${s.id}: ${s.description}`).join("\n");
  const primitives = adapter.primitives.map((p) => `    - ${p.op}: ${p.description}`).join("\n");
  const fields = adapter.manifestFields.map((f) => `    - ${f.key} (${f.type}${f.required ? ", required" : ""}): ${f.description}`).join("\n");
  return `Adapter: ${adapter.name}\nScene types:\n${sceneTypes}\nPrimitives:\n${primitives}\nManifest fields:\n${fields}`;
}

export async function draftManifestAndPlan(
  adapter: ProdlensAdapter,
  surface: ProductSurface,
  opts: { model?: string } = {}
): Promise<DraftResult> {
  const model = opts.model ?? process.env.LLM_MANIFEST_MODEL ?? "qwen/qwen3-32b";
  let lastErr: unknown;
  // One retry: a cheaper model occasionally emits malformed JSON the first time.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await localChat({
        system: "You draft product demo walkthroughs as strict, valid JSON. Use double quotes for all keys and string values, and no trailing commas.",
        text: draftPrompt(adapter, surface),
        maxTokens: 4000,
        temperature: 0.3,
        model,
      });
      if (res.error || !res.content) throw new Error(`Manifest draft failed: ${res.error ?? "empty response"}`);
      return parseDraft(res.content, surface);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Manifest draft: could not parse LLM output.");
}

function draftPrompt(adapter: ProdlensAdapter, surface: ProductSurface): string {
  return (
    `You are drafting a product demo walkthrough for the tool Prodlens. Given a product's surface ` +
    `(discovered screens, docs, source) and an adapter's capabilities, produce a JSON document with:\n` +
    `1. "manifest": an object matching the adapter's manifest fields (baseUrl, surfaces, resources).\n` +
    `2. "plan": { title, mode: string[], scenes: [{ name, narrate, primitives: [{op, args}], needs?: [{id, resource, purpose}], cursor?: [{x,y}] }] }\n\n` +
    `Rules:\n` +
    `- Each scene narrates ONE moment and lists the primitives that make it happen, in order.\n` +
    `- Only use primitive ops the adapter provides.\n` +
    `- If a scene's primitives cause navigation or a state change (create, submit, attach, upload), set "expect": { "urlIncludes": "<substring of the result URL>" } so the demo waits for and shows the RESULT.\n` +
    `- If a scene needs an external resource (phone number, api key, file, running service), add a needs entry.\n` +
    `- The plan should tell the story of what the product DOES, end to end - not just list screens.\n` +
    `- Narration under 25 words per scene, conversational, not salesy.\n` +
    `- STRICT JSON: double-quoted keys/strings, no trailing commas, no comments.\n\n` +
    `=== ADAPTER ===\n${describeAdapter(adapter)}\n\n` +
    `=== PRODUCT SURFACE ===\n${describeSurface(surface)}\n\n` +
    `Respond with ONLY the JSON document (no markdown fences, no prose).`
  );
}

function parseDraft(content: string, surface: ProductSurface): DraftResult {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Manifest draft: no JSON found in LLM response.");
  const parsed = parseLenientJson(match[0]) as { manifest: ProductManifest; plan: WalkthroughPlan };
  // Normalize: ensure scenes have the shape we expect.
  const scenes: SceneSpec[] = (parsed.plan?.scenes ?? []).map((s) => ({
    name: s.name ?? "Scene",
    narrate: s.narrate,
    primitives: s.primitives ?? [],
    needs: s.needs,
    cursor: s.cursor,
    expect: s.expect,
  }));
  const plan: WalkthroughPlan = {
    title: parsed.plan?.title ?? surface.description ?? "Product walkthrough",
    mode: parsed.plan?.mode ?? ["ux"],
    scenes,
  };
  return { manifest: parsed.manifest, plan, text: content };
}

/** Parse LLM JSON output leniently: strip markdown fences, tolerate unquoted
 *  keys and trailing commas (common with cheaper models). Falls back to strict
 *  JSON.parse first. */
export function parseLenientJson(input: string): unknown {
  let text = input.trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(text);
  } catch {
    // Unquote bare keys: {key: value} -> {"key": value}
    text = text.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
    // Remove trailing commas before } or ]
    text = text.replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(text);
  }
}
