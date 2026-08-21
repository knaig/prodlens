// Public adapter SDK - the stable import surface generated adapter modules use.
// A synthesized adapter (e.g. <repo>/prodlens/adapter.mjs) imports from here.
export { registerAdapter, listAdapters } from "./engine.js";
export type { ProdlensAdapter, PrimitiveInvocation, PrimitiveResult, PrimitiveContext, PrimitiveDef, SceneSpec, SceneTypeDef, ResourceNeed, ResourceResolution, ProductManifest, ProductSurface, CapturedArtifact } from "./types.js";
