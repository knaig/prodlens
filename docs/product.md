# prodlens — product description

> **One tool, two outputs: prove a product works, and show it working.**
> Given a web product's repo (and optionally a running dev server), prodlens
> recovers what the product *is* (screens, transitions, APIs, streams), plans the
> critical user journeys, executes them against the real app, and renders a
> narrated demo video with a real cursor - all from the same walkthrough.

This is the living, authoritative product description. It should be updated
whenever the product changes. Last updated with the web-app (walkthrough studio),
adapter synthesis, capture hardening, and consent-gate work.

---

## 1. What it is

Prodlens is a **product-agnostic demo + verification engine**. It treats a web
product (or platform / open-source product) as a **graph of screens and
transitions**, plus whatever other surfaces it exposes (REST endpoints, websocket
streams, CLI, files). From that graph it:

- **Verifies** the product: unreachable screens, dead ends, missing return
  paths, broken edges, dead buttons, blank/spinner/clipped renders.
- **Plans** the critical journeys (personas → prioritized paths) and executes
  them against the live app, filling forms and recording what actually happens.
- **Demos** it: turns the same walkthrough into a narrated MP4 with a real
  cursor, captions, a persona intro, flow diagrams, and an architecture
  walkthrough - for anyone to watch without running the app.

The core insight that keeps it product-agnostic: **product differences live in an
adapter (and a manifest), not in the engine.** Prodlens knows *how to demo*; an
adapter tells it *what this product can do*.

---

## 2. The problem it solves

- AI-assisted ("vibe-coded") UIs accumulate a specific failure mode: buttons that
  render but do nothing, links to routes that no longer exist, screens designed
  but never wired into navigation. Normal dev/test loops check *"does this one
  flow work"* - nothing checks *"is every edge functional across the whole graph."*
- Product demos are manual, scripted, and stale a week later. Teams re-record
  screen captures by hand every time the UI changes.
- Platform / open-source products (like VoiceEra) have value that a screen tour
  can't show: calls, audio, APIs, streams, architecture. A click-through misses
  *what the product actually does*.

Prodlens attacks both halves with one pipeline: it verifies the whole graph, and
it produces a demo that reflects the product as it runs today.

---

## 3. Value proposition

**One repeatable pipeline that turns a running web app into two things at once -
a verification report and a shareable, narrated demo - and re-runs on every
change.** For any product:

1. A living map of the product (screens + transitions) revealing gaps no one was
   tracking.
2. A verification report after every change - re-run, see what broke.
3. A narrated demo video + screenplay, generated automatically, that always
   matches the current product - no manual screen-capture sessions.

Because it drives a real browser and talks to the real app, **the demo and the
report describe the same reality**: "here is proof it works, and here is what it
looks like."

---

## 4. How it works (the flow)

### 4.1 Discovery — build the surface
Two complementary passes produce a graph:

- **Static pass** (`src/discovery/static/`, ts-morph): route inventory + every
  interactive element classified as `navigates | server-action | local-state |
  dead`. No browser, no server, CI-friendly.
- **Live crawl** (`src/discovery/crawler.ts`, Playwright): BFS from entry points,
  reads real rendered `href`s, clicks real elements, detects forms/input clusters,
  records what actually happens.

The two merge into one `GraphVersion` (intended), analyzed for unreachable
screens, dead ends, missing return paths, broken edges, and dead elements.

For platform/open-source products, the surface also includes **repo contents**:
README, API routes, websocket/stream handlers, configs, manifests, CLI entry
points (`ProductSurface.fileContents`) - so the tool can *understand* the product,
not just list its files.

### 4.2 Plan — prioritize journeys
`prioritize` infers personas (LLM or heuristic) and proposes journeys. **Every
step is grounded in a real edge from the graph** (BFS to the target), never free
text - so execution is deterministic. Forms get heuristic `InputScenario`s filled
before submit.

`review` is the manual gate: approve / reject / edit each path. `run` executes
approved paths in parallel Playwright workers, fills forms, records the actual
graph, with an LLM agent fallback when a selector can't be resolved.

### 4.3 Report — diff intended vs actual
`report` diffs intended vs actual, ranks issues by severity, produces a
CI-friendly exit code, and appends `TraceFeedback` for the GEPA reflection loop
that tunes the next plan.

### 4.4 Demo / walkthrough — show it
Two paths produce narrated videos:

- **`demo`** (`src/execution/demo.ts`): a scripted click-through of the real app -
  pre-synthesized narration (no in-timeline TTS latency), narration anchored to
  screen-ready time, cursor overlay or real OS cursor, live scrolling, captions,
  silent twin + screenplay. Outputs: voiced MP4, silent MP4, `screenplay.json`,
  `screenplay.md`.
- **`walkthrough`** (the LLM-drafted path, product-agnostic): given a repo, an
  LLM drafts a **persona-first plan** (persona intro → ux screens → flow diagram →
  architecture), the user reviews it, and the engine executes + renders. Scenes
  can be browser actions, flow diagrams (mermaid), architecture slides, or
  persona cards - with `expect` semantics so the demo waits for and shows the
  *result* of each action.

---

## 5. Adapters — the product-agnostic layer

A `ProdlensAdapter` (`src/adapters/types.ts`) is the only product-specific code.
It declares:

| member | purpose |
| --- | --- |
| `id`, `name` | identity |
| `detect(surface)` | can this adapter drive the product? |
| `manifestFields` | schema the LLM fills when drafting the manifest |
| `sceneTypes` | scene types the LLM can propose (`persona`, `ux`, `flow`, `architecture`, product-specific like `voice-call`) |
| `primitives` | the verbs the engine executes (`browser.*`, `http.*`, `stream.*`, `file.*`, `run.*`, `observe.*`, product-specific) |
| `resolveResource(need, surface)` | docs → source → `{ satisfied | obtainable | blocked }` |
| `provisionResource?` | optionally obtain the resource via the product's own UI/API |
| `execute(primitive, ctx)` | run a primitive; return `{ ok, error?, artifacts? }` |

Primitives return **captured artifacts** (`screenshot | audio | video | json |
log | text`) that the video renderer plays back - so a voice product plays back
the recorded call, a data tool shows the result table, a CI tool shows the log.
This is how a demo "shows what happened" for any product.

### 5.1 Two ways to get an adapter

1. **Hand-written** (stable, reviewed) - e.g. the core `web` adapter handles any
   web app out of the box (`browser.*` + ux/flow/architecture scenes).
2. **Synthesized on the fly** (`prodlens adapter`, or `walkthrough --synthesize`):
   the LLM reads the repo and **generates the adapter module itself** - the SDK
   is coded for the product, not shipped per-product. Validation loop: import it,
   run `detect()`, feed errors back, retry (up to 3×). Written to
   `<repo>/prodlens/adapter.mjs`.

For voicera, synthesis discovered the voice server `:7860`, Plivo/VoBiz
telephony, the WebSocket `/agent/{id}`, and generated primitives
`make-outbound-call`, `get-call-recording`, `test-browser-connection` - the
call/audio/barge-in demo capability, from the repo alone.

### 5.2 Resources

A scene can declare `needs: [{ id, resource, purpose }]`. `resolveResource` per
adapter decides each is `satisfied`, `obtainable` (docs/source show how), or
`blocked` (user must supply). Scenes with blocked resources are **skipped with a
note** rather than failing the whole demo - the review form surfaces the
checklist so the user can supply values and re-run.

---

## 6. Modes

`--mode ux|flow|architecture|...` (combinable) controls what a demo shows:

- **ux** - screen-by-screen walkthrough with values entered and results shown.
- **flow** - a single-core-flow diagram (mermaid) of *what the product does*.
- **architecture** - component / rationale walkthrough for open-source products
  (what it's built from, why, honest tradeoffs - never defensive).
- **persona** - an intro card (who / problem / goal) opening a persona-driven demo.
- **call / stream** (product-specific, e.g. voicera) - demonstrate audio/call
  value by driving the product's real stream endpoint.

---

## 7. Capture machinery (the recording experience)

- **Cursor overlay** - a DOM pointer that follows mouse events (default).
- **Real OS cursor** (`--os-cursor`) - the actual pointer driven via `cliclick`
  (macOS) at translated screen coordinates, captured by AVFoundation screen
  recording. The pointer you see in the video is the OS pointer.
- **True cursor lock** - the cursor is warped back to the demo's position on any
  deviation, so the operator can't wander it mid-recording; re-activates the app
  each poll so nothing pops over the window.
- **Takeover notification** - a macOS notification before the mouse is taken.
- **Abort keys** - Enter / Escape / X / Q release the cursor and stop the demo,
  saving what's captured.
- **Screen-capture consent** - **screen recording never starts without explicit
  consent.** Interactive terminal → type `yes`; anything else (no, non-TTY, pipe)
  refuses and falls back to DOM-overlay + in-page recording.
- **TTS** - Gemini (neural, default in the web app), local Kokoro (free), macOS
  `say`, or `--tts-cmd`; `TTS_BACKEND` pins one. Narration is pre-synthesized so
  TTS latency never enters the video timeline.

---

## 8. Commands

| command | what it does |
| --- | --- |
| `scan` | static pass only (no server) |
| `discover` | live crawl, auth via cached session |
| `prioritize` | personas + journeys (LLM or heuristic) |
| `review` | manual gate: approve/reject/edit |
| `run` | execute approved paths, record actual graph |
| `report` | diff intended vs actual, severity-ranked issues |
| `full` | discover → prioritize → run → report in one shot |
| `explore` | self-contained `explorer.html` |
| `visual` | vision QA over screenshots |
| `gepa` | offline reflection over traces → next-plan guidance |
| `demo` | scripted narrated click-through (real cursor optional) |
| `walkthrough` | LLM-drafted persona-first walkthrough (product-agnostic) |
| `adapter` | synthesize a product adapter from a repo |
| `web` | web app: run walkthroughs from the browser (progress, consent, video) |
| `explain` | narrated explainer from static slides + TTS |
| `capture` / `screens-to-video` / `record-screen` | video capture paths |

Every command that finds critical-severity problems exits non-zero (CI-friendly).

---

## 9. Who it's for

| stakeholder | what they get |
| --- | --- |
| Product / PM | a narrated demo of the product as it is; a navigation map to spot UX gaps |
| Engineering | a repeatable check after every change; broken edges before users hit them |
| QA / Test | auto-generated journeys grounded in real screens, replayable; vision QA pass |
| Founders / GTM | demo videos + screenplays on demand, without screen-capture sessions |
| Support / Onboarding | silent video + screenplay to re-record in their own voice |

---

## 10. Running it

See `docs/cli-reference.md` for flags. The two headline flows:

```bash
# Verify a product
prodlens full --base-url http://localhost:3200 --name my-app --auth custom-login --auth-token-in-localstorage

# Demo it (LLM-drafted, persona-first) - headless, no consent needed
prodlens walkthrough --out data/videos/walkthrough.mp4 \
  --repo-root /path/to/product --base-url http://localhost:3200 \
  --auth custom-login --auth-token-in-localstorage --skip-review

# Demo it with the real cursor (asks for screen-capture consent interactively)
prodlens walkthrough --out data/videos/walkthrough-os.mp4 \
  --repo-root /path/to/product --base-url http://localhost:3200 --os-cursor ...

# Generate a product adapter from a repo, on the fly
prodlens adapter --repo-root /path/to/product

# Web app
prodlens web --port 7788   # -> http://localhost:7788
```

LLM features use `LLM_BASE_URL`/`LLM_API_KEY` (OpenRouter by default: DeepSeek
text, Qwen vision, Qwen3-32b manifest/synthesis). Without keys everything falls
back to heuristics.

---

## 11. Honest limitations (read before trusting)

- **Auth** needs a test account (or the app's own login via `custom-login`, or
  Clerk `+clerk_test` auto-signup). The real-OS-cursor demo requires the window
  to stay frontmost + explicit screen-capture consent.
- **Crawler vs real bugs**: some button clicks are flagged "broken" when they
  just open a dialog the crawler can't click through. Flagged edges are leads to
  check, not verdicts.
- **The static pass is Next.js App Router today**; the live crawl is
  framework-agnostic. It needs a running dev server to test the real app.
- **LLM-drafted walkthroughs are best-effort, not guaranteed**: generated
  adapters are validated (import + `detect`), but runtime `execute` uses
  LLM-guessed selectors. Complex in-page wizards (multi-step flows that aren't
  URL edges) often have labels the LLM guesses wrong - those scenes fail
  gracefully (warn + skip), not crash. Treat the first render as a draft: run,
  review the plan, fix, re-run.
- **Quality tracks the model**: Qwen3-32b is decent; swap `--model` for a
  stronger model (e.g. Claude) for hairy repos.
- **Resources**: prodlens identifies what's needed (phone/API key/file) from
  docs→source and skips blocked scenes - it does not magically obtain a real
  phone number.

---

## 12. Status / roadmap

**Built**: graph discovery + verification pipeline; LLM synthesis with heuristics;
parallel execution; GEPA loop; video capture (demo, walkthrough, explain, capture,
record-screen); real OS cursor + lock + abort + consent; adapter SDK; **adapter
synthesis** (JIT adapter codegen from a repo); persona intro + result semantics;
web app (walkthrough studio); docs.

**Ongoing**: capture hardening; voicera voice adapter as the stream/call proof;
refining synthesized-adapter runtime reliability.

**Roadmap**: React Router / other static-pass adapters; real import-graph tracing;
static-pass form detection; semantically-aware scenarios; agent fallback that can
replan; explorer graph diagram; richer GEPA.

See `docs/architecture.md`, `docs/adapters.md`, `docs/cli-reference.md`,
`docs/data-models.md`, `docs/llm-client.md`, and `docs/voicera.md` for depth.
