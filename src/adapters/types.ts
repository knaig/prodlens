// Prodlens Adapter SDK - the one abstraction that keeps prodlens product-
// agnostic. A product's "what it actually does" is expressed through an
// adapter (coded plugin) that declares the interaction surfaces, scene types,
// primitives, and resources that product exposes. Prodlens core knows no
// product specifics - it executes primitives and renders scenes; the adapter
// supplies the verbs.
//
// The LLM drafts a product manifest against an adapter's schema; the user
// reviews it; the engine executes the approved scenes via the adapter's
// primitives, playing back captured artifacts (audio, video, JSON, logs).

/** The surface of a product that an adapter detects and then drives. */
export interface ProductSurface {
  /** Discovered navigation graph (nodes/edges), when a live/static discovery ran. */
  graph?: unknown;
  /** Screenshot paths per screen, when available. */
  screenshots?: Record<string, string>;
  /** Static-pass architecture/component inventory, when a static scan ran. */
  components?: ComponentInfo[];
  /** Raw source files / repo tree, when source is accessible. */
  source?: string[];
  /** Docs files (README, docs/, config examples) when present. */
  docs?: string[];
  /** Key file contents (API routes, streams, configs, CLI) - what adapter
   *  synthesis needs to READ the product, not just list its files. */
  fileContents?: { path: string; content: string }[];
  /** User-supplied one-line description of the product. */
  description?: string;
}

/** A static-pass component/module entry, used for architecture walkthroughs. */
export interface ComponentInfo {
  name: string;
  path: string;
  role?: string;
  externalDeps?: string[];
}

/** A resource a scene needs (phone number, API key, sample file, running
 *  service). Resolution is: docs first, then source, then user must supply. */
export interface ResourceNeed {
  id: string;
  /** What it is, e.g. "phone_number". */
  resource: string;
  purpose: string;
}

export type ResourceStatus = "satisfied" | "obtainable" | "blocked";

export interface ResourceResolution {
  status: ResourceStatus;
  /** How to obtain it (from docs or source), when obtainable. */
  how?: string;
  /** What the user must supply, when blocked. */
  neededFromUser?: string;
  /** The value, when already satisfied. */
  value?: string;
}

/** A captured artifact a scene produces and the video plays back. */
export interface CapturedArtifact {
  kind: "screenshot" | "audio" | "video" | "json" | "log" | "text";
  path: string;
  label?: string;
}

/** An interaction primitive - the only verbs the engine knows. Adapters
 *  register their own; the engine executes them generically. */
export interface PrimitiveInvocation {
  op: string; // "browser.goto", "http.post", "stream.send", ...
  args: Record<string, unknown>;
}

export interface PrimitiveResult {
  ok: boolean;
  error?: string;
  /** Artifacts captured by this primitive (audio reply, screenshot, JSON...). */
  artifacts?: CapturedArtifact[];
}

/** One scene in a walkthrough: narration + the primitives that make it happen
 *  + optional resources it needs. */
export interface SceneSpec {
  name: string;
  narrate?: string;
  /** Primitive invocations, executed in order. */
  primitives: PrimitiveInvocation[];
  /** Resources this scene needs (resolved before rendering). */
  needs?: ResourceNeed[];
  /** Where the scene's cursor should point on a static slide (optional). */
  cursor?: { x: number; y: number }[];
  /** Result semantics: after the primitives run, wait for this to be true
   *  before capturing the scene (so the "what happened" moment is shown).
   *  `urlIncludes` = wait until the page URL contains this substring. */
  expect?: { urlIncludes?: string; settleMs?: number };
}

/** The approved, renderable walkthrough produced from a manifest + scenes. */
export interface WalkthroughPlan {
  title: string;
  /** "ux" | "flow" | "architecture" | adapter-specific scene group labels. */
  mode: string[];
  scenes: SceneSpec[];
}

/** Zod schema shape the adapter requires of its product manifests. */
export interface ManifestField {
  key: string;
  type: "string" | "string[]" | "record" | "boolean";
  description: string;
  required?: boolean;
  default?: unknown;
}

/** A registered scene type the LLM can propose (e.g. "voice-call"). */
export interface SceneTypeDef {
  id: string;
  description: string;
  /** Fields the LLM fills when proposing this scene type. */
  fields: ManifestField[];
}

/** A registered primitive (verb) the LLM can invoke. */
export interface PrimitiveDef {
  op: string; // "stream.send", "browser.goto", ...
  description: string;
  args: ManifestField[];
}

/** The contract every product adapter implements. */
export interface ProdlensAdapter {
  id: string;
  name: string;
  /** Can this adapter drive the given product surface? */
  detect(surface: ProductSurface): boolean;
  /** Schema fields a manifest for this adapter must/can carry. */
  manifestFields: ManifestField[];
  /** Scene types this adapter contributes (e.g. "voice-call"). */
  sceneTypes: SceneTypeDef[];
  /** Primitives (verbs) this adapter contributes. */
  primitives: PrimitiveDef[];
  /** Resolve how to obtain a resource (docs → source → user). */
  resolveResource(resource: ResourceNeed, surface: ProductSurface): Promise<ResourceResolution>;
  /** Optionally obtain the resource via the product's own UI/API. */
  provisionResource?(resource: ResourceNeed, surface: ProductSurface): Promise<ResourceResolution>;
  /** Execute a primitive invocation. Returns artifacts (audio, JSON, ...). */
  execute(primitive: PrimitiveInvocation, ctx: PrimitiveContext): Promise<PrimitiveResult>;
}

/** Execution context handed to primitives. */
export interface PrimitiveContext {
  surface: ProductSurface;
  /** Browser page, when the adapter uses one (set by the engine for browser/stream work). */
  page?: import("playwright").Page;
  /** Working dir for captured artifacts. */
  workDir: string;
  /** The product manifest (adapter-specific fields). */
  manifest: Record<string, unknown>;
  /** When set, browser primitives drive the REAL OS cursor (cliclick) at these
   *  screen coordinates instead of Playwright's CDP mouse. */
  osCursor?: { geom: import("../execution/os-cursor.js").WindowGeometry };
}

/** Product manifest = adapter id + adapter-specific fields. */
export interface ProductManifest {
  adapter: string;
  surfaces: {
    baseUrl?: string;
    endpoints?: { name: string; method: string; path: string; auth?: string }[];
    streams?: { name: string; url: string; protocol?: string }[];
    cli?: string[];
  };
  resources?: Record<string, unknown>;
  [key: string]: unknown;
}
