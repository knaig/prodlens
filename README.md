# prodlens

Looks at a whole web product through one lens: it recovers the app's UI as a
graph of screens and transitions, verifies every edge (broken links, dead ends,
unreachable screens), plans and runs the critical user journeys, and turns the
same walkthrough into a narrated demo with a real cursor - without you having to
click through every screen by hand after every change.

Built because AI-assisted ("vibe-coded") UIs accumulate a specific failure
mode: buttons that render but do nothing, links to routes that no longer
exist, screens nobody actually wired into the app's navigation. Normal
dev/test loops check "does this one flow work" - nothing checks "is every
node reachable and every edge functional across the whole graph." This does.

## How it works

Two complementary discovery passes feed one graph:

1. **Static pass** (`src/discovery/static/`) - parses the app's source with
   `ts-morph`. No browser, no server, no flakiness. Builds a route inventory
   (Next.js App Router today) and classifies every interactive element:
   - `navigates` - a `<Link>`, `router.push`, or `redirect()` with a resolvable target
   - `server-action` - `onClick` calls an imported `"use server"` action
   - `local-state` - `onClick` only touches local component state
   - `dead` - no `onClick`, no `href`, no form action. Does nothing.

   This alone catches a real class of bug in seconds: a button that looks
   wired but isn't. On lazy-dist it caught a "Publish" button whose server
   action existed and was used elsewhere, just never imported into that page.

2. **Live crawl** (`src/discovery/crawler.ts`) - Playwright, a real browser.
   BFS from configured entry points, reads the *actual rendered* `href`
   attributes (resolves anything the static pass can't - template literals,
   runtime auth redirects), clicks buttons, records what really happens.
   Authenticates once via Clerk (`@clerk/testing`) and caches the session
   (`storageState`) - "log in once per portal," not once per test.

The two graphs merge (`src/graph/graph-store.ts`) and get analyzed
(`src/graph/analysis.ts`) for: unreachable screens, dead-end screens, missing
return paths, broken edges, dead elements, and local-state-only elements
flagged for manual triage (some are legitimately just UI state, not bugs).

Beyond the two discovery passes, a thin end-to-end pipeline (`prioritize` ->
`review` -> `run` -> `report`, or `full` for all of it in one shot) treats
the merged graph as a versioned artifact (`GraphVersion`,
`src/graph/graph-store.ts`):

- **`prioritize`** (`src/prioritization/synthesize.ts`) infers personas and
  proposes prioritized journeys - via an LLM if one is configured (see
  `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL` in `.env.example`), or a heuristic
  fallback (first N reachable non-entry screens) otherwise.
  Every step in a journey is grounded in a real edge from the intended graph
  (found by BFS to the chosen target node), not free text - so it can be
  replayed deterministically. Any screen a journey passes through that the
  live crawler found a `<form>` on (`src/discovery/form-scan.ts`) gets a
  heuristic `InputScenario` grounded onto that edge (`edge.inputScenarioId`),
  so `run` fills the form before clicking submit instead of clicking it empty.
- **`review`** (`src/prioritization/review.ts`) is the manual gate between
  planning and execution: approve, reject, or edit each path's goal
  (interactively, or non-interactively via `--approve`/`--reject
  <ids...>`/`--approve-all`). `run` refuses to execute a path still
  `"planned"` unless you pass `--skip-review`.
- **`run`** (`src/execution/executor.ts`) replays each approved path against
  the live app with Playwright, using a bounded pool of concurrent workers
  (`--concurrency`, default 4, each with its own browser context) and
  recording the *actual* graph as it goes. A step whose selector/quoted
  label can't be resolved on the page falls back to an LLM agent
  (`src/execution/agent-fallback.ts`) that picks the best-matching clickable
  element for the step's goal, when an LLM is configured.
- **`report`** diffs intended vs actual (`GraphDiff`) and turns the diff plus
  per-path results into a severity-ranked `Issue[]` / `VerificationReport`,
  and appends the run's `TraceFeedback` to `traces.json` for `gepa`.
- **`explore`** (`src/reporting/explorer.ts`) writes a self-contained
  `explorer.html` - no server, open it directly in a browser - with the
  graph, its analysis, and (if passed `--paths`/`--results`) the prioritized
  paths and their pass/fail status.
- **`visual`** (`src/visual/triage.ts`) is a vision QA pass on top of the
  screenshots the crawler/executor already capture: it asks a vision-capable
  model (e.g. `qwen-vl-max`, configurable via `LLM_VISION_MODEL`) per
  screenshot to flag what DOM-based analysis cannot - blank/empty renders,
  endless spinners, clipped/overflowing layouts, visually-dead buttons.
  `report --visual <that file>` folds the findings into the issue list so
  severity ranking, `explore`, and CI exit codes include them. Uses any
  OpenAI-compatible endpoint (`LLM_BASE_URL`); a screen it can't read is
  recorded per-shot as an error, never a false finding - nothing about the
  crawler's or `report`'s behavior changes if the endpoint is down.
- **Run-versioned output**: every command that produces artifacts (`visual`,
  `report`) writes into a fresh `data/projects/<app>/runs/v0.<n>/` folder -
  the version is the parent, artifact types are subfolders underneath, and the
  number increments per invocation, so re-running never overwrites a prior
  run's output. `traces.json` (the `gepa` accumulation) stays at the project
  root on purpose - it must accumulate across runs, not fragment per run.
- **`gepa`** (`src/prioritization/gepa.ts`) is the offline optimization loop
  over accumulated `TraceFeedback`: reflects on recent runs (via an LLM if one
  is configured, a heuristic issue-type digest otherwise) into
  guidance text saved to `data/gepa/guidance.json`, which the next
  `prioritize` run automatically appends to its synthesis prompt (disable
  with `prioritize --no-gepa`).
- **`explain`** (`src/execution/explain.ts`) builds a narrated product
  explainer MP4 from a screenplay JSON (`{ scene: [{ png, narrate? }] }`) -
  per-scene screenshot plus a narration line become one video. Narration is
  Gemini 2.5 Flash TTS (neural voices with `--voice`, needs `GEMINI_API_KEY`,
  ~$0.02/video) with a macOS `say` fallback and a `--tts-cmd` hook for any
  other TTS.
- **`demo`** (`src/execution/demo.ts`) records a narrated product demo: it
  drives the real app in a headed browser through a scripted walkthrough
  (`goto`/`fill`/`click` + narration lines), scrolls each screen through live
  so the recording shows the full page, burns the narration in as captions,
  and emits four artifacts - a voiced MP4 (Kokoro/Gemini/say TTS), a silent
  twin for re-voice-over, a timestamped `screenplay.json`, and a human-readable
  `screenplay.md` script of what to say and when. `--auth clerk-signup` creates
  a fresh test account on the fly (no pre-provisioned credentials); a vision
  LLM can auto-write narration lines for screens the script didn't cover.

## Usage

```bash
npm install
npx playwright install chromium

# Static pass only - fast, no server needed, CI-friendly
npx tsx src/index.ts scan \
  --app-dir /path/to/app/src/app \
  --tsconfig /path/to/app/tsconfig.json \
  --name my-app

# Live crawl - needs the target app's dev server running
npx tsx src/index.ts discover \
  --base-url http://localhost:3000 \
  --entry / \
  --auth none            # or "clerk-password" with UX_FLOW_TEST_EMAIL/PASSWORD set

# Merge a live crawl into an existing static scan's graph
npx tsx src/index.ts discover --base-url ... --merge-with ./data/graph.json

# Full pipeline: discover -> prioritize -> run -> report, one shot
# (skips the manual review gate - every path is auto-approved)
npx tsx src/index.ts full --base-url http://localhost:3000 --name my-app

# Or step by step, with a manual review gate before executing the plan:
npx tsx src/index.ts prioritize --graph ./data/graph.json
npx tsx src/index.ts review --paths ./data/paths.json          # interactive approve/reject/edit
npx tsx src/index.ts run --paths ./data/paths.json --graph ./data/versions/<intended-id>.json --base-url http://localhost:3000
npx tsx src/index.ts report --intended ./data/versions/<intended-id>.json --actual ./data/versions/<actual-id>.json --results ./data/path-results.json
# ...and fold a visual QA result into that report. Both commands default to a
# fresh runs/v0.<n>/ parent under the data/projects/<app>/ that the graph lives
# in - the version is the parent, artifact types are subfolders:
# npx tsx src/index.ts report ... --visual data/projects/<app>/runs/v0.1/visual/<version-id>.json

# Explore the graph/paths in a browser - no server needed
npx tsx src/index.ts explore --graph ./data/graph.json --paths ./data/paths.json --results ./data/path-results.json

# Visual QA pass (uses LLM_VISION_MODEL, default qwen-vl-max, via an OpenAI-
# compatible endpoint configured with LLM_BASE_URL/LLM_API_KEY - e.g. DeepSeek,
# Qwen/DashScope, Kimi/Moonshot, or a local server):
# looks at every discovered screen's screenshot and flags rendering problems the
# structural analysis can't see: blank/empty screens, endless spinners, clipped
# layouts, visually-dead buttons. Pure batched inference over existing
# screenshots, no browser. Findings fold into 'report' via --visual. Output
# lands at <project>/runs/v0.<n>/visual/<version-id>.json (new version per run).
npx tsx src/index.ts visual --graph data/projects/<app>/discovery/versions/<intended-id>.json

# GEPA reflection: after a few report runs, distill accumulated feedback into
# guidance the next 'prioritize' run applies automatically
npx tsx src/index.ts gepa

# Narrated product explainer from screenshots (Gemini TTS; needs GEMINI_API_KEY)
npx tsx src/index.ts explain --script ./screenplay.json --out ./data/videos/explainer.mp4

# Narrated product demo that drives the live app (headed browser walkthrough,
# scrolls each screen, burns captions, emits voiced MP4 + silent twin + screenplay)
npx tsx src/index.ts demo --script ./demo.json --out ./data/videos/demo/demo.mp4 \
  --auth clerk-password --data-dir ./data --base-url http://localhost:3000

# Auto-signup: creates a fresh Clerk test account on the fly (needs the app to
# support the +clerk_test email convention), so no credentials are needed
npx tsx src/index.ts demo --script ./demo.json --out ./data/videos/demo/demo.mp4 \
  --auth clerk-signup --data-dir ./data

# Draft a demo script from a discovered graph (edit the .draft.json, re-run with --script)
npx tsx src/index.ts demo --out ./data/videos/demo/auto.mp4 \
  --from-graph ./data/graph.json --from-paths ./data/paths.json \
  --value-prop "An autopilot for your distribution." --auth clerk-signup

# Voice-over re-recording: get the silent video + screenplay, write your own lines,
# and record them yourself - or just use the screenplay as your delivery script
npx tsx src/index.ts demo --script ./demo.json --out ./data/videos/demo/demo.mp4 --no-voice
```

Every command that finds critical-severity problems (dead elements, broken
edges, failed paths) exits non-zero - CI-friendly by default. Set `LLM_BASE_URL`
(and `LLM_API_KEY` for hosted APIs) to enable LLM-based persona/journey
inference in `prioritize`/`full`, the run-time agent fallback, and GEPA
reflection; without it, all of them fall back to heuristics (first N reachable
screens as journeys, one generic persona).

## Limitations (read before trusting a report)

- **Clerk challenges every fresh browser context as a "new device,"
  independent of `@clerk/testing`'s bot-detection bypass.** The testing
  token (`setupClerkTestingToken`) stops CAPTCHA/bot checks; it does not
  stop Clerk's separate "verify this device by email code" step, which
  fires on every Playwright run because a clean context has no device
  history. Fix: create the test account with an email using Clerk's
  documented `+clerk_test` convention (e.g. `name+clerk_test@example.com`,
  the email equivalent of its `+1XXX5550100` test phone numbers) - the
  fixed code `424242` verifies it with no real inbox needed. A plain email
  address will hang here indefinitely waiting for a code nobody can
  retrieve.
- **`Locator.isVisible()` does not wait.** Unlike `click()`/`fill()`, it
  checks the DOM's current state immediately and does not retry - using it
  to detect a screen that appears after an async transition (e.g. Clerk's
  code-entry step appearing after a form submit) races the page and
  silently returns false. Use `fill()`/`click()`'s own timeout as the real
  wait instead (`src/discovery/auth.ts`).
- **The live crawler's discovery BFS (`discover`) still doesn't fill in
  forms before clicking submit buttons** - only `run`'s executor does,
  because it has a specific `InputScenario` grounded onto the edge by
  `prioritize`. A disabled button hit during plain `discover` (e.g.
  "Generate my strategy" before required fields are entered) still reports
  as a broken edge there - correctly-disabled-until-valid isn't
  distinguishable from actually-broken by blind clicking alone.
- **Form detection only happens during the live crawl** (`form-scan.ts`
  needs a real rendered DOM to know input types/names/required-ness) - the
  static pass never populates `node.metadata.forms`. A `scan`-only graph
  (no `discover`) never gets `InputScenario`s.
- **`InputScenario` values are heuristic, by field type/name only** (e.g.
  `email` -> a fake address, a name containing "title" -> "Test title") -
  good enough to get past "is this field non-empty" validation, not a
  substitute for a human picking semantically correct test data. A `<select>`
  is filled via `selectOption`, which needs the heuristic value to match one
  of its real option values or texts - it won't if the options are, say,
  numeric ids.
- **The agent fallback (`src/execution/agent-fallback.ts`) only fires when
  an LLM is configured**, and only re-tries the *current* step by
  clicking a same-page element - it doesn't replan the rest of the path
  around the substitution, and it never overrides the dangerous-label skip.
- **Concurrent `run` workers each open their own browser context**, but all
  read the same `clerk-password` `storageState` file; `runExecution` primes
  auth once before fanning out workers out to avoid a login race, but a
  session that goes stale *mid-run* could still cause more than one worker
  to attempt a fresh login concurrently.
- **A route pattern's node id echoes its folder name literally**, including
  Next.js's `[[...catchAll]]` bracket syntax (e.g.
  `/sign-in/[[...sign-in]]`). Nothing links to that literal bracket string -
  real links go to the plain `/sign-in` path - so these routes always show
  as "unreachable" even though they work. Cosmetic; a future pass should
  normalize catch-all segments out of the reported node id.
- **Merging a live crawl's concrete URLs onto the static graph's route
  patterns needs the SAME specificity-aware matching in both directions.**
  A naive "try literal-only match, then try any-wildcard-ok match" gets
  this wrong for patterns that mix literal and dynamic segments -
  `/sip/studio/new` matches both `/[project]/studio/new` (2 literal
  segments) and `/[project]/studio/[id]` (1 literal segment), and a
  two-pass approach can't tell them apart. `src/graph/route-match.ts`
  scores every candidate by literal-segment count and picks the most
  specific one - if you're extending this, don't regress to the two-pass
  shortcut.
- **Shared components resolve to `from: "*"`** in the static pass (they're
  not colocated with one route - e.g. a persistent sidebar). This codebase's
  heuristic broadcasts `"*"` edges to every page under an `(app)` route
  group, which is correct for lazy-dist's actual layout but is a heuristic,
  not real import-graph tracing. A different app's shared-component pattern
  may need this adjusted.
- **Double-variable templates can't be statically resolved.** A href built
  as `` `/${a}${b}` `` collapses to an unresolvable pattern (no literal
  separator between the two interpolations) - the static pass correctly
  refuses to guess rather than assert a wrong target. This is exactly what
  the live crawl is for: it reads the real rendered `href`, no guessing
  required. Treat static-pass "unreachable"/"missing return path" findings
  for routes only linked from such a component as unconfirmed until a live
  crawl covers them.
- **The live crawler never clicks anything matching a dangerous-label
  pattern** (delete/kill/archive/disconnect/remove/rotate/deactivate) by
  default - it records those as `untested`, not `broken`. This is
  deliberate: a flow crawler must never be the thing that destroys real
  data or disconnects a real integration.
- **Clerk auth requires a real test account.** `@clerk/testing`'s testing
  token bypasses bot/CAPTCHA detection; it does not forge a session out of
  nothing. Create a test user in the target app and set
  `UX_FLOW_TEST_EMAIL` / `UX_FLOW_TEST_PASSWORD`.

## Documentation

- [docs/product.md](docs/product.md) - the complete product description
- [docs/](docs/) - architecture, CLI reference, data models, LLM client, extension guide, and a full worked example ([voicera.md](docs/voicera.md))
- [docs/adapters.md](docs/adapters.md) - adapters + JIT adapter synthesis (prodlens reads a product's repo and the LLM codes the adapter on the fly)
- `data/tutorial/tutorial.mp4` - a narrated video walkthrough of the full pipeline
  with a cursor that glides to each stage as it is narrated (see
  `data/tutorial/tutorial-screenplay.json` for the cursor-keyframe `explain` format)
- `data/projects/voicera/tutorial/voicera-tutorial.mp4` - the same treatment for a
  real app (VoiceEra), the cursor pointing at each service as the stack is narrated

## Roadmap

- React Router / other framework adapters for the static pass (currently Next.js App Router only)
- Real import-graph tracing to replace the `from: "*"` shared-component heuristic
- Static-pass form detection (currently live-crawl-only, see Limitations)
- Semantically-aware `InputScenario` values (currently type/name heuristics only), and partitioned scenarios (valid/invalid/edge-case) rather than one-per-form
- Agent fallback that can replan remaining steps, not just substitute the current click
- `explorer.html` graph layout (currently a flat filterable list + detail panel, no node/edge diagram)
- GEPA guidance beyond appended prompt text - e.g. mutating which node-selection heuristics `synthesizeHeuristically` uses when no LLM is configured
