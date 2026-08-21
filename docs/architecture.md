# Architecture

prodlens is a pipeline: it recovers a web app's UI as a graph of screens and
transitions, plans critical journeys over that graph, executes them against the
live app, and produces both verification reports and narrated demo videos.

## Component map

```
src/
  discovery/    Recovery: static AST pass + live Playwright crawl
    static/       ts-morph route inventory + interaction classification
    crawler.ts    BFS crawl, real hrefs + clicks
    auth.ts       session caching (password / clerk-password / clerk-signup)
    form-scan.ts  form + input-cluster detection on live pages
    state-signature.ts  SPA state dedup hashing
  graph/        The spine: nodes/edges/versions + analysis + route matching
    graph-store.ts  save/load/merge/version/diff
    analysis.ts     unreachable, dead-ends, missing returns, broken edges
    route-match.ts  specificity-aware pattern matching
  prioritization/  Plan synthesis + review gate + GEPA loop
    synthesize.ts   personas + journeys (LLM or heuristic), input scenarios
    review.ts       manual approve/reject/edit gate
    gepa.ts         offline reflection over accumulated traces
  execution/     Running journeys + producing videos
    executor.ts     parallel Playwright execution, form fills, agent fallback
    agent-fallback.ts  LLM picks a best-matching element when a selector fails
    capture.ts      journey replay -> webm; screenshots -> mp4; screen capture
    demo.ts         narrated product demo (scripted/guided), cursor, scroll
    explain.ts      still-screenshot explainer + TTS + cursor keyframes
  llm/          One OpenAI-compatible client (DeepSeek/Qwen/Kimi via OpenRouter)
    local.ts        text/vision/tool calls, auth header, graceful degradation
  visual/       Vision QA over screenshots (qwen-vl)
    triage.ts       blank/spinner/clipped/dead-button detection
  reporting/    Reports + explorer
    reporter.ts     markdown + severity-ranked issues
    explorer.ts     self-contained explorer.html + Projects tab
    projects.ts     per-app artifact collection
  run/          versioned run output folders
    version.ts      createRunDir: runs/v0.<n>/
```

## Control flow

One CLI (`prodlens <cmd>`), orchestrated in `src/index.ts`. Each command is
a thin wrapper that reads artifacts, calls a module, writes artifacts.

- `scan` — static pass only, no server. Writes `graph.json` + markdown report.
- `discover` — live crawl, merges into a static graph if given `--merge-with`.
- `prioritize` — writes `versions/<intended-id>.json`, `personas.json`,
  `paths.json`, `scenarios.json`.
- `review` — the manual gate; flips path statuses.
- `run` — reads approved paths + intended version, writes
  `versions/<actual-id>.json` + `path-results.json`.
- `report` — diffs intended/actual, writes `verification-report.json` +
  markdown; appends `TraceFeedback` to `traces.json`.
- `full` — discover -> prioritize -> run -> report in one shot (auto-approves).
- `explore` — writes a self-contained `explorer.html`.
- `visual` — vision QA over screenshots -> `runs/v0.<n>/visual/<id>.json`.
- `gepa` — reflects over `traces.json` -> `guidance.json`.
- `demo` / `explain` / `capture` / `record-screen` — video paths.

See [CLI reference](cli-reference.md) for every flag.

## Data flow (artifacts)

Every stage writes versioned artifacts; nothing is free text between stages.

```
scan / discover -> graph.json
prioritize       -> versions/intended-*.json, personas.json, paths.json, scenarios.json
review           -> paths.json (status flipped)
run              -> versions/actual-*.json, path-results.json
report           -> verification-report.json, reports/verify-*.md, traces.json
gepa             -> gepa/guidance.json  (injected into next prioritize prompt)
visual           -> runs/v0.N/visual/<id>.json  (folded into report issues)
demo / explain   -> *.mp4, screenplay.json, screenplay.md
```

`traces.json` accumulates across runs on purpose - it feeds the GEPA reflection
that tunes the next plan. Run folders (`runs/v0.<n>/`) are created fresh per
invocation so re-running never overwrites prior output.

## Concurrency & auth

- `run` uses a bounded worker pool (default 4), each worker with its own browser
  context. Auth is primed once before fanning out to avoid a login race.
- Sessions are cached to `storage-state/session.json` and reused until proven
  stale (navigating a protected path bounces to sign-in).
- `clerk-signup` creates a fresh test account on the fly via the `+clerk_test`
  convention (fixed verification code 424242).
- `custom-login` is for apps with their own auth (JWT in localStorage, no
  Clerk): it fills the app's sign-in form and caches the session. Pass
  `--auth-token-in-localstorage` when the token lives in localStorage (e.g.
  `access_token`). Used for e.g. the VoiceEra monorepo.
- The crawler never clicks dangerous labels (delete/kill/archive/...) - those are
  recorded `untested`.

## Two discovery passes, one graph

The static pass (`ts-morph`) classifies every interactive element:
`navigates`, `server-action`, `local-state`, or `dead`. The live crawl reads
actual rendered hrefs (resolving template literals and auth redirects the static
pass can't) and clicks real elements. The two merge; route matching is
specificity-aware so a literal pattern beats a dynamic one when both could match.

## Video pipeline (demo/explain)

- `explain` — static slides + TTS narration, one clip per scene, concatenated.
  Scenes may carry `cursor` keyframes: a sprite glides (eased) to each point,
  so a tutorial literally points at the diagram element being narrated.
- `demo` — records the real app headed: cursor overlay, live scroll per screen,
  pre-synthesized TTS (no in-timeline latency), narration anchored to
  screen-ready time, clips sequenced so they never overlap. Emits a voiced MP4,
  a silent twin, `screenplay.json`, and `screenplay.md`.

See [data models](data-models.md), [LLM client](llm-client.md), and
[extension guide](extension-guide.md) for the deep details.
