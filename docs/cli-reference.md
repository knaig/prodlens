# CLI reference

`prodlens <command> [flags]`. Every command that finds critical-severity
problems exits non-zero - CI-friendly by default.

## scan

Static pass only: parse the app's source for routes and navigation wiring. No
browser, no server.

| flag | required | default | description |
| --- | --- | --- | --- |
| `--app-dir <path>` | yes | | Next.js app directory (e.g. `<repo>/src/app`) |
| `--src-root <path>` | | parent of app-dir | root to scan for interactions |
| `--tsconfig <path>` | | | tsconfig for better type resolution |
| `--name <name>` | | `app` | app name for the report title |
| `--out <dir>` | | `./data` | output for graph.json + report |

## discover

Live crawl with Playwright: visits real pages, clicks real elements.

| flag | required | default | description |
| --- | --- | --- | --- |
| `--base-url <url>` | yes | | e.g. `http://localhost:3100` |
| `--entry <paths...>` | | `["/"]` | entry paths to start from |
| `--max-pages <n>` | | `40` | max pages to visit |
| `--max-depth <n>` | | `4` | max BFS depth |
| `--auth <strategy>` | | `none` | `none \| password \| clerk-password \| clerk-signup \| custom-login` |
| `--auth-token-in-localstorage` | | | with `--auth custom-login`: the app stores its auth token in localStorage (e.g. `access_token`) |
| `--out <dir>` | | `./data` | output dir |
| `--merge-with <path>` | | | merge into an existing graph.json |

## prioritize

Synthesis: infer personas + prioritized journeys (LLM if configured, heuristic
otherwise).

| flag | required | default | description |
| --- | --- | --- | --- |
| `--graph <path>` | yes | | graph.json or a saved GraphVersion |
| `--out <dir>` | | `./data` | output dir |
| `--max-personas <n>` | | `3` | max personas to infer |
| `--max-journeys <n>` | | `2` | max journeys per persona |
| `--no-gepa` | | | skip guidance.json, even if present |

## review

Manual gate: approve/reject/edit each path. Interactive by default.

| flag | required | default | description |
| --- | --- | --- | --- |
| `--paths <path>` | yes | | paths.json from prioritize |
| `--approve <ids...>` | | | approve these path ids non-interactively |
| `--reject <ids...>` | | | reject (skip) these path ids |
| `--approve-all` | | | approve every still-planned path |

## run

Execution: replay approved paths against the live app, recording the actual graph.

| flag | required | default | description |
| --- | --- | --- | --- |
| `--paths <path>` | yes | | paths.json |
| `--graph <path>` | yes | | the intended GraphVersion saved by prioritize |
| `--base-url <url>` | yes | | e.g. `http://localhost:3100` |
| `--auth <strategy>` | | `none` | none \| password \| clerk-password \| clerk-signup \| custom-login |
| `--auth-token-in-localstorage` | | | with `--auth custom-login`: the app stores its auth token in localStorage (e.g. `access_token`) |
| `--out <dir>` | | `./data` | output dir |
| `--concurrency <n>` | | `4` | concurrent path workers |
| `--skip-review` | | | run every path regardless of review status |
| `--no-agent-fallback` | | | disable the LLM agent fallback |

## report

Analysis: diff intended vs actual, produce the verification report.

| flag | required | default | description |
| --- | --- | --- | --- |
| `--intended <path>` | yes | | intended GraphVersion |
| `--actual <path>` | yes | | actual GraphVersion |
| `--results <path>` | yes | | path-results.json |
| `--name <name>` | | `app` | report title |
| `--out <dir>` | | fresh `runs/v0.<n>/` | output dir |
| `--visual <path>` | | | fold a visual QA JSON into the issues |

## explore

Interactive graph/path explorer + Projects tab. Writes a self-contained HTML file.

| flag | required | default | description |
| --- | --- | --- | --- |
| `--graph <path>` | yes | | graph.json or GraphVersion |
| `--paths <path>` | | | paths.json |
| `--results <path>` | | | path-results.json |
| `--name <name>` | | `app` | page title |
| `--out <dir>` | | `./data` | output dir |
| `--project <dir>` | | | project out-dir for the Projects tab |
| `--spec-dir <dir>` | | | spec/docs dir to surface |
| `--web-assets <dir>` | | | copy videos/images for static hosting |

## visual

Vision QA: a vision LLM (qwen-vl via LLM_VISION_MODEL) flags rendering problems
per screenshot - blank screens, endless spinners, clipped layouts, dead buttons.

| flag | required | default | description |
| --- | --- | --- | --- |
| `--graph <path>` | yes | | graph.json or GraphVersion |
| `--out <dir>` | | fresh run dir | output dir |
| `--screenshots <dir>` | | | reconstruct per-node screenshots from here |
| `--concurrency <n>` | | `1` | parallel vision requests |
| `--model <name>` | | env LLM_VISION_MODEL | vision model id |

## gepa

Offline reflection over accumulated traces into guidance for the next plan.

| flag | required | default | description |
| --- | --- | --- | --- |
| `--out <dir>` | | `./data` | where traces.json lives |

## demo

Record a narrated click-through demo. Emits voiced MP4 + silent twin +
screenplay.json + screenplay.md.

| flag | required | default | description |
| --- | --- | --- | --- |
| `--script <path>` | * | | demo JSON (or use `--from-graph`) |
| `--out <path>` | yes | | output MP4 |
| `--base-url <url>` | | | overrides baseUrl in the script |
| `--auth <strategy>` | | `none` | none \| password \| clerk-password \| clerk-signup \| custom-login |
| `--auth-token-in-localstorage` | | | with `--auth custom-login`: the app stores its auth token in localStorage (e.g. `access_token`) |
| `--data-dir <path>` | | `./data` | storage-state location |
| `--voice <name>` | | `Kore` | Gemini neural voice |
| `--scale <filter>` | | `1280:-2` | output resolution |
| `--no-voice` | | | skip the voiced render |
| `--no-captions` | | | don't burn captions |
| `--from-graph <path>` | * | | synthesize a draft from a graph |
| `--from-paths <path>` | | | paths.json (with --from-graph) |
| `--value-prop <text>` | | | one-line value prop for intro/screenplay |

\* exactly one of `--script` or `--from-graph` is required.

### demo script JSON

```jsonc
{
  "title": "lazy-dist",
  "valueProp": "An autopilot for your distribution.",
  "intro": { "title": "lazy-dist", "tagline": "Your distribution, on autopilot.", "narrate": "Meet lazy-dist..." },
  "baseUrl": "http://localhost:3100",
  "entry": "/projects",
  "viewport": { "width": 1440, "height": 860 },
  "voice": "Kore",
  "scroll": "tour",          // "tour" | "down" | false
  "steps": [
    { "name": "Projects home", "narrate": "This is the projects home...", "settleMs": 500 },
    { "name": "Open Lumen", "click": "Lumen", "narrate": "Open the Lumen project..." },
    { "name": "Strategy", "goto": "/lumen/strategy", "narrate": "The strategy document..." }
  ]
}
```

Step fields: `name`, `narrate`, `goto`, `click`, `fill` (selector->value map),
`selector`, `pointer {x,y}`, `scroll`, `settleMs`.

## explain

Build a narrated product-explainer MP4 from a screenplay JSON. Scenes may carry
`cursor` keyframes that glide a sprite across the slide to illustrate narration.

| flag | required | default | description |
| --- | --- | --- | --- |
| `--script <path>` | yes | | screenplay JSON |
| `--out <path>` | yes | | output MP4 |
| `--voice <name>` | | `Kore` | TTS voice |
| `--rate <wpm>` | | `180` | narration speed |
| `--scale <filter>` | | `1280:-2` | output resolution |
| `--tts-cmd <cmd>` | | | external TTS hook |

### explain screenplay JSON

```jsonc
{
  "title": "prodlens: the full pipeline",
  "scene": [
    {
      "png": "data/tutorial/slides/slide-title.png",
      "narrate": "This is the full pipeline. Watch the cursor.",
      "cursor": [
        { "at": 1.2, "x": 139, "y": 198 },
        { "at": 3.2, "x": 336, "y": 198 }
      ],
      "holdAfter": 0.8
    }
  ]
}
```

`cursor` positions are in output-video coordinates (e.g. 1280x718 for
`--scale 1280:-2`). Times are relative to scene start. The sprite eases between
keyframes and holds at the last one.

## capture / screens-to-video / record-screen / full

- `capture` — replay one prioritized journey to a `.webm`.
- `screens-to-video` — assemble per-step PNGs into an MP4 (no browser).
- `record-screen` — capture the mac screen via AVFoundation.
- `full` — discover + prioritize + run + report in one shot.
