// Adapter registry + the walkthrough engine. Keeps a set of adapters, picks
// the right one(s) for a product surface, executes scenes via the adapter's
// primitives, and assembles captured artifacts for the video renderer.
import { resolve } from "node:path";
import type {
  CapturedArtifact,
  PrimitiveContext,
  PrimitiveInvocation,
  ProdlensAdapter,
  ProductManifest,
  ProductSurface,
  ResourceNeed,
  ResourceResolution,
  WalkthroughPlan,
} from "./types.js";

// Held on globalThis, not in module scope. A product's adapter imports the SDK
// by its own path (typically the built dist/ entry), which is a DIFFERENT
// module instance from the src/ one the runtime loads under tsx. Two instances
// meant two registries: the adapter registered into one, the renderer looked in
// the other, and every session scene was skipped as "no adapter declares this
// op" while the adapter had in fact loaded fine. One registry per process.
const REGISTRY_KEY = Symbol.for("prodlens.adapters.registry");
const globals = globalThis as { [REGISTRY_KEY]?: Map<string, ProdlensAdapter> };
const registry: Map<string, ProdlensAdapter> = (globals[REGISTRY_KEY] ??= new Map());

/** Register an adapter (called at import time by adapters). */
export function registerAdapter(adapter: ProdlensAdapter): void {
  registry.set(adapter.id, adapter);
}

/** Load an external adapter from a file path or package spec (e.g. a product
 *  repo's adapter module). The module registers itself by calling
 *  registerAdapter at import time. Resolved relative to process.cwd(). */
export async function loadExternalAdapter(spec: string): Promise<void> {
  const resolved = spec.startsWith(".") || spec.startsWith("/") ? new URL(`file://${resolve(spec)}`) : new URL(`file://${resolve(process.cwd(), spec)}`);
  await import(resolved.href);
}

/** All registered adapters. */
export function listAdapters(): ProdlensAdapter[] {
  return [...registry.values()];
}

/** Pick adapters that can drive the given surface (all that match). If `prefer`
 *  names an adapter not yet registered, try loading it as an external file. */
export async function selectAdaptersAsync(surface: ProductSurface, prefer?: string): Promise<ProdlensAdapter[]> {
  if (prefer && !registry.has(prefer)) {
    await loadExternalAdapter(prefer).catch((e) => {
      throw new Error(`Adapter "${prefer}" not registered and could not be loaded: ${e instanceof Error ? e.message : String(e)}`);
    });
  }
  if (prefer && registry.has(prefer)) return [registry.get(prefer)!];
  return [...registry.values()].filter((a) => a.detect(surface));
}

/** Pick adapters synchronously (for adapters already registered in-process). */
export function selectAdapters(surface: ProductSurface, prefer?: string): ProdlensAdapter[] {
  if (prefer && registry.has(prefer)) return [registry.get(prefer)!];
  return [...registry.values()].filter((a) => a.detect(surface));
}

/** Resolve every resource a plan needs, per adapter (docs → source → user). */
export async function resolvePlanResources(
  adapter: ProdlensAdapter,
  plan: WalkthroughPlan,
  surface: ProductSurface
): Promise<Record<string, ResourceResolution>> {
  const needs = new Map<string, ResourceNeed>();
  for (const scene of plan.scenes) for (const n of scene.needs ?? []) needs.set(n.id, n);
  const out: Record<string, ResourceResolution> = {};
  for (const need of needs.values()) {
    let res = await adapter.resolveResource(need, surface);
    if (res.status === "obtainable" && adapter.provisionResource) {
      const provisioned = await adapter.provisionResource(need, surface);
      if (provisioned.status !== "blocked") res = provisioned;
    }
    out[need.id] = res;
  }
  return out;
}

/** Split a plan into runnable scenes vs scenes whose resources are blocked.
 *  Blocked-resource scenes are skipped with a note, not fatal - so a demo can
 *  still render the parts that need nothing external. */
export async function partitionPlanByResources(
  adapter: ProdlensAdapter,
  plan: WalkthroughPlan,
  surface: ProductSurface
): Promise<{ runnable: WalkthroughPlan; blocked: { scene: WalkthroughPlan["scenes"][number]; resources: string[] }[] }> {
  const resolutions = await resolvePlanResources(adapter, plan, surface);
  const runnableScenes = [];
  const blocked: { scene: WalkthroughPlan["scenes"][number]; resources: string[] }[] = [];
  for (const scene of plan.scenes) {
    const sceneBlocked = (scene.needs ?? [])
      .map((n) => resolutions[n.id])
      .filter((r): r is ResourceResolution => !!r)
      .filter((r) => r.status === "blocked")
      .map((r) => r.neededFromUser ?? "blocked");
    if (sceneBlocked.length) blocked.push({ scene, resources: sceneBlocked });
    else runnableScenes.push(scene);
  }
  return {
    runnable: { ...plan, scenes: runnableScenes },
    blocked,
  };
}

/** Execute one scene's primitives in order, collecting artifacts. */
export async function executeScene(
  adapter: ProdlensAdapter,
  scene: WalkthroughPlan["scenes"][number],
  ctx: PrimitiveContext
): Promise<CapturedArtifact[]> {
  const artifacts: CapturedArtifact[] = [];
  for (const p of scene.primitives) {
    const result = await adapter.execute(p, ctx);
    if (!result.ok) throw new Error(`Primitive ${p.op} failed: ${result.error ?? "unknown error"}`);
    if (result.artifacts) artifacts.push(...result.artifacts);
  }
  return artifacts;
}

/** Assemble a renderable plan: the plan itself plus resolved resources. */
export interface RenderablePlan {
  plan: WalkthroughPlan;
  resources: Record<string, ResourceResolution>;
  artifacts: CapturedArtifact[];
}

export async function executePlan(
  adapter: ProdlensAdapter,
  plan: WalkthroughPlan,
  surface: ProductSurface,
  manifest: ProductManifest,
  workDir: string
): Promise<RenderablePlan> {
  const resources = await resolvePlanResources(adapter, plan, surface);
  const blocked = Object.entries(resources).filter(([, r]) => r.status === "blocked");
  if (blocked.length) {
    const details = blocked.map(([id, r]) => `${id}: ${r.neededFromUser}`).join("; ");
    throw new Error(`Blocked resources - ${details}`);
  }
  const ctx: PrimitiveContext = { surface, workDir, manifest };
  const artifacts: CapturedArtifact[] = [];
  for (const scene of plan.scenes) {
    artifacts.push(...(await executeScene(adapter, scene, ctx)));
  }
  return { plan, resources, artifacts };
}

export type { PrimitiveInvocation, ProdlensAdapter, ProductManifest, ProductSurface, ResourceNeed, ResourceResolution, WalkthroughPlan };
