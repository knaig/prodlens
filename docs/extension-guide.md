# Extension guide

How to extend prodlens. The pipeline is deliberately module-per-stage with
thin orchestration in `src/index.ts`.

## Add a new CLI command

1. Create a module under the relevant `src/` subfolder exporting a function.
2. Register a `program.command("name")` in `src/index.ts` with
   `.description(...)`, flags, and an `.action(...)` that reads inputs, calls
   the module, and writes outputs (use `writeJson`).
3. Write outputs into a fresh run dir when they're per-invocation artifacts
   (`createRunDir` / `projectRootForPath`), or into the stable project root when
   they must accumulate (`traces.json`).

## Add a discovery pass

A pass produces part of a `Graph` (nodes + edges) that the live crawl merges
onto. Steps:

1. Implement the pass as a function returning `{ nodes, edges, entryPoints }`
   following the types in `types.ts`.
2. Wire it into `discover`'s action (or add a new command).
3. If it classifies interactions, reuse the `StaticClassification` values so
   analysis and the reporter understand it.
4. Merge with `mergeGraphs` / `remapGraphToPatterns` so the two passes combine
   into one graph. Route matching must stay specificity-aware
   (`src/graph/route-match.ts`) - never regress to the two-pass shortcut.

## Add a TTS backend

`synthTts` in `src/execution/explain.ts`:

1. Add a branch for your backend in the `TTS_BACKEND` switch.
2. Implement `synth<TtsName>tts(text, ...)` writing audio to `outPath`.
3. Add it to the `auto` candidate list (order matters - cheapest/most-available
   first after `--tts-cmd`).

## Add an LLM consumer

Use `localChat` from `src/llm/local.ts`. Patterns:

- Text classification: `localChat({ system, text, maxTokens })`, parse `content`.
- Structured output: pass `tool` with an `inputSchema`; read `toolInput`.
- Vision: pass `images: [pngPath]`; model defaults to `LLM_VISION_MODEL`.
- Always handle `res.error` / empty content - degrade, never crash.

## Add a cursor-keyframe scene type

`explain` scenes accept `cursor: [{ at, x, y }]`. The sprite glides (eased)
between keyframes and holds at the last. Keyframe coordinates are in **output**
video space. To extend (e.g. click states, resize):

- Sprite + scaling: `writeCursorSprite` in `src/execution/explain.ts`.
- Overlay expression: `encodeScene` - piecewise eased `x`/`y` via `if(lt(t,...))`.

## Conventions

- Every AI feature has a heuristic fallback; the tool runs with zero keys.
- Never throw for a network/parse failure in `localChat` - return `{ error }`.
- The crawler never clicks dangerous labels; record them `untested`.
- Version every per-invocation artifact; accumulate cross-run state on purpose.
- Run `npm run build` and `npm test` before committing.
