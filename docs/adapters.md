# Adapters & adapter synthesis

Prodlens stays product-agnostic by driving products through **adapters** - small
modules that teach prodlens *how to talk to a product* (its browser surface, REST
endpoints, websocket/streams, CLI, files, and the resources those need). The
adapter is the only product-specific code; the engine, walkthrough planner,
renderer, and video pipeline know nothing about any product.

## The two ways to get an adapter

### 1. Hand-written (stable, reviewed)

```js
// <repo>/prodlens/adapter.mjs  (or anywhere, load via --adapter <path>)
import { registerAdapter } from "prodlens/adapters";

const adapter = {
  id: "myapp",
  name: "My App",
  detect: (surface) => /* true if this adapter drives surface */,
  manifestFields: [
    { key: "baseUrl", type: "string", description: "App base URL", required: true },
  ],
  sceneTypes: [
    { id: "ux", description: "screen walkthrough scene", fields: [] },
  ],
  primitives: [
    { op: "browser.goto", description: "navigate to a path", args: [{ key: "path", type: "string", required: true }] },
  ],
  async resolveResource(need, surface) {
    // docs -> source -> { status: "blocked", neededFromUser }
    return { status: "blocked", neededFromUser: `supply ${need.resource}` };
  },
  async execute({ op, args }, ctx) {
    // ctx.page (Playwright Page), ctx.workDir, ctx.manifest, ctx.surface
    return { ok: true, artifacts: [{ kind: "screenshot", path }] };
  },
};

registerAdapter(adapter);
```

### 2. Synthesized on the fly (JIT adapter synthesis)

Prodlens reads the product's repo (README, API routes, stream/websocket handlers,
configs, CLI entry points - via `ProductSurface.fileContents`) and asks an LLM to
**generate the adapter module itself**:

```
prodlens adapter --repo-root /path/to/product --out /path/to/product/prodlens
```

or automatically inside `walkthrough` when no adapter matches:

```
prodlens walkthrough --out demo.mp4 --repo-root /path/to/product --synthesize ...
```

The generated module is validated by importing it and running `detect()` against
the surface; on any import/detect error, the error is fed back to the LLM and it
retries (up to 3 attempts). The result is a working, product-specific adapter -
the SDK is *coded for the product*, not shipped per-product.

## The adapter contract

`ProdlensAdapter` (`src/adapters/types.ts`):

| member | purpose |
| --- | --- |
| `id`, `name` | identity |
| `detect(surface)` | can this adapter drive the given product surface? |
| `manifestFields` | schema the LLM fills when drafting the product manifest |
| `sceneTypes` | scene types the LLM can propose (e.g. `voice-call`, `flow`, `architecture`) |
| `primitives` | the verbs the engine executes (e.g. `browser.goto`, `stream.send`, `http.call`) |
| `resolveResource(need, surface)` | docs → source → `{ status: "satisfied"|"obtainable"|"blocked", ... }` |
| `provisionResource?` | optionally obtain the resource via the product's own UI/API |
| `execute(primitive, ctx)` | run a primitive; return `{ ok, error?, artifacts? }` |

### `PrimitiveContext`

- `ctx.page` - a Playwright `Page` (browser adapters use this)
- `ctx.workDir` - scratch dir for captured artifacts
- `ctx.manifest` - the product manifest (adapter-specific fields)
- `ctx.surface` - the `ProductSurface`
- `ctx.osCursor` - when set, browser primitives should drive the real OS cursor
  (see `--os-cursor`)

### Captured artifacts

Primitives return `artifacts` (`{ kind: "screenshot"|"audio"|"video"|"json"|"log"|"text", path }`)
which the video renderer plays back as scene assets - an audio reply, a result
JSON, a log, a screenshot. This is how a demo "shows what happened" for any
product: a voice product plays back the recorded call, a data tool shows the
result table, a CI tool shows the log.

## Resources

A scene can declare `needs: [{ id, resource, purpose }]`. Before rendering,
`resolveResource` per adapter decides each is `satisfied`, `obtainable` (docs or
source show how), or `blocked` (the user must supply it). Scenes with blocked
resources are skipped with a note rather than failing the whole demo - the
review form surfaces the checklist so you can supply values and re-run.

## Where adapters live

- **Synthesized / product-owned**: `<repo>/prodlens/adapter.mjs` - versionable,
  ships with the product (open-source friendly).
- **Prodlens-managed**: `data/projects/<app>/adapters/` via `--out`.

Load any adapter by path: `prodlens walkthrough --adapter /path/to/adapter.mjs ...`
or `--adapter <registered-id>` (e.g. `web`).

## Screen capture consent

`--os-cursor` mode records the real screen (AVFoundation) so the actual OS
cursor appears in the video. **Screen capture never starts without explicit
user consent.** Before recording, prodlens prompts on an interactive terminal:

```
[prodlens] The demo will RECORD YOUR SCREEN (AVFoundation) to capture the real cursor.
Your screen (including any visible windows) will be recorded. Type "yes" to allow, or "no" to cancel:
```

- Interactive terminal + user types `yes` → recording starts.
- Anything else (`no`, non-TTY, piped stdin) → **refuses** and falls back to
  the DOM-overlay + in-page recording (no screen capture).

The operator can stop at any time with **Enter / Escape / X / Q** - the cursor
lock is released immediately and the partial demo is saved.

## The core web adapter

`src/adapters/web-adapter.ts` (`id: "web"`) handles any web app out of the box:
`browser.*` primitives, ux/flow/architecture scene types, and docs→source resource
resolution. It's auto-selected when no product-specific adapter matches, so most
web products need zero adapter code - synthesis only kicks in for products with
non-web surfaces (streams, CLI, audio, telephony).
