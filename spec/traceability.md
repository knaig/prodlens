# Prodlens Traceability Matrix

Part of the [Prodlens specification](README.md). This file closes the loop in
both directions: **spec -> code** through the matrices below, and **code ->
spec** through the header-comment index in §8.

**Spec revision:** 4 - **Last updated:** 2026-08-25

## How to read it

| status | meaning |
| --- | --- |
| `implemented` | a code path exists and satisfies the requirement |
| `partial` | exists, but narrower than the requirement states |
| `spec-only` | specified, not yet built - the gap is named in §6 |
| `not-started` | specified, no work begun |

Statuses were verified by reading the named modules on 2026-08-25. They are a
snapshot: **changing a requirement means updating its row in the same commit**
(README §6).

---

## 1. v1 functional requirements

Defined in [Prodlens-Product-Spec.md](Prodlens-Product-Spec.md) §5.

### 1.1 Reverse engineering (FR-RE)

| id | requirement | spec | module | status |
| --- | --- | --- | --- | --- |
| FR-RE-1 | screens / major UI states with screenshots + state signatures | P§5.1, T§4.2 | `src/discovery/crawler.ts`, `src/discovery/state-signature.ts` | implemented |
| FR-RE-2 | interactive elements + observed/inferred transitions | P§5.1 | `src/discovery/crawler.ts`, `src/discovery/static/ast-scan.ts` | implemented |
| FR-RE-3 | intended navigation graph, first-class + versionable | P§5.1, P§5.6 | `src/graph/graph-store.ts` | implemented |
| FR-RE-4 | core personas + critical journeys | P§5.1, T§4.3 | `src/prioritization/synthesize.ts` | implemented |
| FR-RE-5 | light signals of primary user goals | P§5.1 | `src/respec/respec.ts` (`goals`, `oneLiner`) | implemented (v2 §3 subsumes the v1 scope) |

### 1.2 Input scenario control (FR-IS)

| id | requirement | spec | module | status |
| --- | --- | --- | --- | --- |
| FR-IS-1 | detect input points affecting navigation/state | P§5.2, T§8.1 | `src/discovery/form-scan.ts` | implemented (incl. `<form>`-less input clusters) |
| FR-IS-2 | no exhaustive combinatorial explosion | P§5.2, T§8.4 | `src/prioritization/synthesize.ts` | implemented (budgeted per path) |
| FR-IS-3 | select high-value variations | P§5.2, T§8.2-8.3 | `src/prioritization/synthesize.ts` | implemented |
| FR-IS-4 | show what was chosen and why others were deprioritized | P§5.2, T§8.5 | `InputScenario.rationale` ([schemas §2.5](schemas.md)) | partial - rationale is stored and rendered; deprioritized alternatives are not enumerated |

### 1.3 Verification engine (FR-VE)

| id | requirement | spec | module | status |
| --- | --- | --- | --- | --- |
| FR-VE-1 | execute prioritized journeys on the live app | P§5.3, T§4.5 | `src/execution/executor.ts` | implemented |
| FR-VE-2 | deterministic steps + goal-oriented agent fallback | P§5.3 | `src/execution/executor.ts`, `src/execution/agent-fallback.ts` | implemented |
| FR-VE-3 | record actual transitions, screenshots, outcomes | P§5.3 | `src/execution/executor.ts`, `src/execution/capture.ts` | implemented |
| FR-VE-4 | detect broken / missing-return / dead-end / unreachable | P§5.3, T§4.6 | `src/graph/analysis.ts` | implemented |
| FR-VE-5 | structured traces + NL feedback for GEPA | P§5.3 | `src/prioritization/gepa.ts` | implemented |

### 1.4 Presentation (FR-UI)

| id | requirement | spec | module | status |
| --- | --- | --- | --- | --- |
| FR-UI-1 | live graph / tree view with status encoding + filters | P§5.4, T§7.1 | `src/reporting/explorer.ts`, `site/explorer.html` | partial - two different explorers. The CLI-generated `explorer.html` is a filterable list + detail panel with **no node/edge diagram**; the web-mode `site/explorer.html` has a d3 graph. Neither updates live during execution - the SSE stream carries stage logs, not graph deltas |
| FR-UI-2 | path explorer, prototype-like | P§5.4, T§7.2 | `src/reporting/explorer.ts`, `site/explorer.html` | implemented (both explorers) |
| FR-UI-3 | mindmap / hierarchical view | P§5.4, T§7.3 | `site/explorer.html` | partial - present in the web-mode explorer only, absent from the CLI-generated report |
| FR-UI-4 | markdown viewer for specs and plans | P§5.4, T§7.4 | `src/reporting/reporter.ts` | implemented |

### 1.5 Review gates (FR-HITL)

| id | requirement | spec | module | status |
| --- | --- | --- | --- | --- |
| FR-HITL-1 | gate after reverse engineering | P§5.5 | web app Vision/Respec tabs (`src/web/server.ts`, `src/web/app-ui.ts`) | implemented as v2 G1/G2 |
| FR-HITL-2 | gate after prioritization | P§5.5 | `src/prioritization/review.ts`, `/api/.../review` | implemented (v2 G4) |
| FR-HITL-3 | gate before large verification runs | P§5.5 | `run` refuses paths still `planned` (`src/index.ts`) | implemented |
| FR-HITL-4 | approve / edit / reject-and-regenerate | P§5.5, T§9 | `src/prioritization/review.ts` (approve/reject/edits) | partial - approve/edit/skip exist; "regenerate with free-text guidance" is wired for studio artifacts, not for journeys |

### 1.6 Graph engineering (FR-GE)

| id | requirement | spec | module | status |
| --- | --- | --- | --- | --- |
| FR-GE-1 | versioned, inspectable, diffable graph | P§5.6, T§5 | `src/graph/graph-store.ts` | implemented |
| FR-GE-2 | explicit intended vs actual | P§5.6, T§5.1 | `GraphVersion.type` ([schemas §2.4](schemas.md)) | implemented |
| FR-GE-3 | algorithms: return-path, dead-end, coverage | P§5.6, T§5.2 | `src/graph/analysis.ts`, `computeCoverage` in `src/graph/graph-store.ts` | implemented |
| FR-GE-4 | graph diff is a core part of the report | P§5.6 | `src/reporting/reporter.ts` | implemented |

Route-pattern folding (`src/graph/route-match.ts`) is load-bearing for FR-GE-2:
without it a static `/[project]/settings` and a live `/lumen/settings` would be
two unrelated nodes and every diff would be noise.

### 1.7 GEPA foundations (FR-GEPA)

| id | requirement | spec | module | status |
| --- | --- | --- | --- | --- |
| FR-GEPA-1 | recovery/synthesis as optimizable modules | P§5.7, T§6.1 | `src/prioritization/synthesize.ts` (guidance injection point) | implemented |
| FR-GEPA-2 | rich diagnostic feedback, not only a scalar | P§5.7, T§6.1 | `TraceFeedback` ([schemas §3](schemas.md)) | implemented |
| FR-GEPA-3 | offline reflective optimization | P§5.7, T§6 | `src/prioritization/gepa.ts`, `gepa` CLI command | implemented |
| FR-GEPA-4 | defined metrics + feedback functions | P§5.7, T§6.2 | `src/prioritization/gepa.ts` | partial - feedback targets exist; there is no labeled training set or scoring harness (T§13 item 12) |

### 1.8 Non-functional (NFR)

Defined in Product-Spec §6.

| id | requirement | module | status |
| --- | --- | --- | --- |
| NFR-1 | modern SPAs (client routing, dynamic content) | `src/discovery/state-signature.ts` | implemented |
| NFR-2 | authenticated areas | `src/discovery/auth.ts` (none/password/clerk-password/clerk-signup/custom-login) | implemented |
| NFR-3 | runnable locally and in CI | `src/index.ts` (headless CLI, non-zero exit) | implemented |
| NFR-4 | parallel path execution | `src/execution/executor.ts` | implemented |
| NFR-5 | transparent inference | `source` / `sourceFile` / `sourceLine` on nodes and edges | implemented |
| NFR-6 | graceful handling of incomplete models | heuristic fallbacks in `src/studio/compile.ts`, `src/respec/respec.ts` | implemented |
| NFR-7 | real-time graph updates during execution | SSE stage log in `src/web/server.ts` | partial - logs stream; the graph itself does not update live (see FR-UI-1) |
| NFR-8 | durable, queryable graph artifacts across runs | `data/projects/<app>/`, `runs/v0.n` | implemented |

## 2. v2 use cases

Defined in [Prodlens-v2-Spec.md](Prodlens-v2-Spec.md) §2.

### 2.1 Product manager (PM)

| id | use case | spec | module | status |
| --- | --- | --- | --- | --- |
| PM1 | feature-tour video | §2.1, §9 V1 | `src/studio/render.ts` (`login` + `screen` scenes) | implemented |
| PM2 | localized narration, voice/accent per market | §2.1, §4.4 | `src/studio/tts.ts` (`VoiceSpec.style`) | partial - voice/style shipped; caption translation + localization gate G6 not built |
| PM3 | demo on live populated data | §2.1, §8 | `src/discovery/auth.ts`, project registry | implemented |
| PM4 | "what changed" re-render of touched scenes only | §2.1, §4 | choreography determinism | spec-only - see D-RERENDER-1 |
| PM5 | live-capability demo (real call / real API action) | §2.1, §4.3 | `src/studio/render.ts`, `src/adapters/session-dom-adapter.ts`, voicera's `prodlens/adapter.mjs` | implemented - a call scene runs a scripted conversation through the product's real UI; the agent side is scripted so the render is deterministic |
| PM6 | architecture summary inside a product video | §2.1, §5.2 | `src/studio/diagram.ts` (`tier: summary`) | implemented |
| PM7 | hand narration to a human voice artist | §2.1, §4 | silent twin + timestamped screenplay | implemented |
| PM8 | bring-your-own prose script | §2.1, §4.2 | `src/studio/compile.ts` (`compileScript`, `draftScript`) | implemented |

### 2.2 QA engineer (QA)

| id | use case | spec | module | status |
| --- | --- | --- | --- | --- |
| QA1 | regression sweep: reachable screens, wired buttons | §2.2 | `scan` + `discover` commands | implemented |
| QA2 | plan and gate critical journeys | §2.2, §6 G4 | `src/prioritization/review.ts` | implemented |
| QA3 | execute approved journeys with form-fill scenarios | §2.2 | `src/execution/executor.ts` | implemented |
| QA4 | triage findings, verdicts feeding GEPA | §2.2, §6 | `/api/.../triage` in `src/web/server.ts` | partial - verdicts stored; the GEPA feed from triage is not wired |
| QA5 | visual QA over screenshots | §2.2 | `src/visual/triage.ts`, `visual` command | implemented |
| QA6 | bug reel from confirmed issues | §2.2, §7 P4 | - | spec-only |
| QA7 | reproduce one flow on demand with recording | §2.2 | `run` + `capture` | partial - single-path re-run exists; "re-run this scene only" UX (§7 principle 7) not built |
| QA8 | track quality across builds, run-to-run diff | §2.2 | `src/run/version.ts` (`runs/v0.n`) | partial - run history exists; the UI diff view does not |
| QA9 | gate a release in CI | §2.2 | headless CLI, non-zero exit | implemented |

### 2.3 Engineer / DevRel (ENG)

| id | use case | spec | module | status |
| --- | --- | --- | --- | --- |
| ENG1 | onboarding tutorial, 5-15 min | §2.3, §5.2 | `src/studio/diagram.ts` (`tier: tutorial`) | implemented |
| ENG2 | "life of a request" scenario explainer | §2.3, §5.3 | `src/studio/diagram.ts` (`scenario`) | implemented |
| ENG3 | written spec of what the code actually does | §2.3, §3 | `src/respec/respec.ts` | implemented |
| ENG4 | diff reverse-spec against written docs | §2.3, §3 | `Respec.drift` ([schemas §6](schemas.md)) | implemented |

## 3. HITL gates

Defined in v2 §6.

| id | gate | artifact | module | status |
| --- | --- | --- | --- | --- |
| G1 | Vision | `vision.md` | `/api/projects/:id/vision` | implemented |
| G2 | Reverse-spec | `respec/spec.md` + drift | `/api/projects/:id/respec`, `.../annotate` | implemented |
| G3 | Surface | `surface.json` | `src/adapters/surface.ts` | partial - surface is produced; no review/exclude UI |
| G4 | Journeys | `paths.json` | `src/prioritization/review.ts` | implemented |
| G5 | Scene plan | `demo-spec.json` storyboard | `/api/projects/:id/studio/*` | partial - spec + narration editable; act-grouped storyboard and audience-contract warnings not built |
| G6 | Localization | screenplay translations | - | spec-only |
| G7 | Resources | needs checklist | `src/studio/preflight.ts` | partial - preflight checks exist; the per-scene blocked-resource checklist does not |
| G8 | Render review | silent draft + screenplay | `src/studio/render.ts` | partial - silent twin renders; per-scene comments and selective re-render not built |
| - | Triage (continuous) | issue list | `/api/.../triage` | partial - see QA4 |

## 4. Web app phases

Defined in v2 §7.

| id | phase | status | notes |
| --- | --- | --- | --- |
| P1 | projects + persistence | implemented | `src/web/registry.ts`, `data/registry.json`, per-project dirs |
| P2 | verification pipeline (QA surface) | partial | stages `scan/discover/prioritize/run/report/visual/respec` wired with SSE; run-history diff view missing (QA8) |
| P3 | respec + vision | implemented | Vision and Respec tabs |
| P4 | demo studio (PM surface) | partial | script/compile/narration/spec/render/registry wired; bug-reel generator missing (QA6) |
| P5 | diagram engine | partial | `src/studio/diagram.ts` ships animated SVG scenes; the v3 renderer set is separate (§5) |
| P6 | call scenes | implemented | scene contract, adapter bridge, reference adapter, and VoicEra's voice adapter; transcript + protocol-frame capture land as scene artifacts. Translation captions still belong to G6 |
| P7 | onboarding + sharing | partial | `src/studio/preflight.ts` exists; `--host` + token LAN sharing not built |

## 5. Diagrams v3

Defined in v2 §5.4. Built as a separate workspace in `diagrams/`
(elkjs + Remotion + @remotion/player confirmed in `diagrams/package.json`).

| renderer | status |
| --- | --- |
| structural (static system map) | partial - the build order's first item |
| sequence (one run's messages) | partial |
| state-machine (aggregate over runs) | not-started - needs many traces |
| deployment (nested containers, trust boundary) | not-started |
| activity / flowchart (pipeline stages + gates) | not-started |

**Integration gap D-DIAGV3-1:** `diagrams/` is not wired into the studio
pipeline. `src/studio/diagram.ts` renders its own animated SVG; the v3
renderers are not yet the studio's diagram backend.

## 6. Known divergences

Spec ahead of code is legal; silence is not (README §4). Every current
divergence is listed here.

| id | divergence | spec | reality | direction |
| --- | --- | --- | --- | --- |
| D-CALL-1 | *(closed 2026-08-25)* live sessions against the real voice backends | v2 §4.3, §9 V2 | contract, bridge, reference adapter and VoicEra's adapter are all built and tested. VoicEra's scripts the WebSocket the browser test dialog speaks, so a session is deterministic and needs no `:7860`/STT/TTS stack. Driving those live backends end to end is deliberately out of scope - it is not repeatable, so it is not how demos render | resolved |
| D-DEMOSPEC-1 | v2 §4.1 shows `"product"` and `micAudio` in the DemoSpec sketch | `DemoSpec2.projectId`, `Scene2.micWav` in `src/studio/types.ts` | prose sketch is stale; [schemas §5.2](schemas.md) is normative | spec prose wrong |
| D-FRAMES-1 | v2 §4.6/§13.7 say frames are data in `frames/*.json` | `FRAMES` is a constant in `src/studio/types.ts`; no `frames/` directory exists | spec ahead of code (externalization not done) |
| D-RERENDER-1 | per-scene re-render of only changed scenes (PM4) | choreography and `specHash` exist; selective re-render does not | spec ahead of code |
| D-DIAGV3-1 | v3 renderers are the diagram backend | `diagrams/` workspace is standalone | spec ahead of code |
| D-PRICING-1 | two pricing models coexist | v2 §12.3 per-artifact quotas vs §13.10 credits; `src/web/pricing.ts` implements the tier table | §13.10 supersedes (README §2.2); §12.3 is annotated |
| D-HOSTED-1 | hosted control plane: orgs, seats, Clerk auth, Razorpay billing, Blob artifacts | none present - the `clerk-*` strings in `src/discovery/auth.ts` are strategies for logging into *target apps*, unrelated to prodlens's own auth | not-started, matching v2 §12.4 |
| D-RUNNER-1 | runner protocol v1 (claim / log / complete) | `src/runner/agent.ts` implements the runner side; the control-plane endpoints it calls are not built here | partial |

## 7. Triage of `partial` rows

A `partial` is not automatically work to do. Each one is either a gap worth
closing or a requirement that overreached and should be amended — leaving them
undecided is what makes a status column meaningless. Recommendations below;
the decision is the spec owner's, and acting on one means editing the
requirement or the code and updating its row.

**Relax the requirement** — specified more than the product needs:

| id | what's missing | why relax |
| --- | --- | --- |
| `FR-UI-1`, `NFR-7` | the graph does not update live during execution | live graph deltas need a streaming graph protocol and a re-layout-on-update viewer. The SSE stage log already answers "what is happening now", and the graph is read after a run, not during. Amend both to "progress streams during execution; the graph is rendered on completion" |
| `FR-UI-3` | mindmap only in the web-mode explorer | two explorers with different feature sets is the real issue. Either scope the requirement to the web explorer or fold the CLI report into it — do not build a second mindmap |
| `FR-IS-4` | deprioritized alternatives are not enumerated | storing every rejected scenario to display it is a large cost for a rarely-read justification. `rationale` on the chosen scenario already carries the signal. Amend to "the chosen scenario carries a rationale" |

**Close the gap — small, high value:**

| id | what's missing | why now |
| --- | --- | --- |
| `QA4` | triage verdicts are stored but never reach GEPA | this closes the reflection loop the whole GEPA design exists for. Verdicts are already captured; the missing piece is feeding them in as `TraceFeedback` |
| `FR-HITL-4` | reject-and-regenerate-with-guidance works for studio artifacts, not journeys | the mechanism exists on the studio side; applying it to the journey gate is reuse, not new design |
| `QA8`, `P2` | run history exists, no run-to-run diff view | `runs/v0.n` and `GraphDiff` both exist; this is a view over data already on disk |

**Close the gap — larger, sequence behind the divergences in §6:**

| id | what's missing | depends on |
| --- | --- | --- |
| `PM2`, `G6` | caption translation and the localization gate | narration variants exist (`schemas.md` §5.1); needs the gate UI |
| `G8`, `PM4` | per-scene comments and selective re-render | choreography determinism is in place; needs `specHash` per scene |
| `P5` | v3 renderers as the studio diagram backend | `D-DIAGV3-1` |
| `QA6`, `P4` | bug reel generated from confirmed issues | `QA4` first — it needs confirmed verdicts |
| `FR-GEPA-4` | labeled training set and scoring harness | the last open item from Technical-Spec §13 |
| `G3`, `G5`, `G7` | gate UIs: surface review, act-grouped storyboard, per-scene resource checklist | web app work, independent of each other |
| `P7` | `--host` + token for LAN sharing | independent |
| `D-RUNNER-1` | control-plane endpoints the runner already calls | `D-HOSTED-1` |

## 8. Code -> spec index

Modules carrying a spec anchor in their header comment. This is the
**code -> spec** direction; keep it accurate when adding modules.

| module | anchor |
| --- | --- |
| `src/types.ts` | [schemas.md](schemas.md) §2-3 |
| `src/studio/types.ts` | v2 §4, §2.4, §4.6 |
| `src/studio/render.ts` | v2 §4 (PM1, PM5) |
| `src/studio/diagram.ts` | v2 §5 (PM6, ENG1, ENG2) |
| `src/studio/compile.ts` | v2 §4.2 (PM8) |
| `src/studio/tts.ts` | v2 §4.4 (PM2) |
| `src/studio/preflight.ts` | v2 §7 P7, §6 G7 |
| `src/studio/store.ts` | v2 §4, §13.8 |
| `src/respec/respec.ts` | v2 §3 (ENG3, ENG4) |
| `src/web/pricing.ts` | v2 §13.10 |
| `src/usage/ledger.ts` | v2 §12.2 |
| `src/adapters/types.ts` | v2 §1.1, §4.3 |
| `src/adapters/session-dom-adapter.ts` | v2 §4.3, §9 |
| `src/adapters/session-dom-adapter.test.ts` | v2 §4.3 |
| `src/adapters/voicera-adapter.test.ts` | v2 §4.3, §9 V2 |
| `src/execution/demo.test.ts` | v2 §4.3 |
| `src/llm/tts-cache.ts` | v2 §4.4, §12.2 |
| `src/llm/tts-cache.test.ts` | v2 §4.4 |
| `src/execution/os-cursor.ts` | v2 §4 (PM1) |
| `src/execution/os-cursor.test.ts` | v2 §4 (PM1) |
| `src/graph/analysis.ts` | `FR-VE-4`, `FR-GE-3` |
| `src/graph/graph-store.ts` | `FR-GE-1`, `FR-GE-2`, `FR-GE-3` |
| `src/graph/route-match.ts` | `FR-GE-2` |
| `src/discovery/crawler.ts` | `FR-RE-1`, `FR-RE-2`, `NFR-1` |
| `src/discovery/form-scan.ts` | `FR-IS-1` |
| `src/discovery/auth.ts` | `NFR-2`, v2 §8 |
| `src/execution/executor.ts` | `FR-VE-1`, `FR-VE-3`, `NFR-4` |
| `src/execution/agent-fallback.ts` | `FR-VE-2` |
| `src/prioritization/synthesize.ts` | `FR-RE-4`, `FR-IS-2`, `FR-IS-3`, `FR-GEPA-1` |
| `src/prioritization/review.ts` | `FR-HITL-2`, `FR-HITL-4`, G4 |
| `src/prioritization/gepa.ts` | `FR-GEPA-3`, `FR-VE-5` |
| `src/visual/triage.ts` | `QA5` |
| `src/reporting/reporter.ts` | `FR-GE-4`, `FR-UI-4` |
| `src/reporting/explorer.ts` | `FR-UI-1`, `FR-UI-2`, `FR-UI-3` |
| `src/discovery/state-signature.ts` | `FR-RE-1`, `NFR-1` |
| `src/discovery/static/ast-scan.ts` | `FR-RE-2` |
| `src/execution/capture.ts` | `FR-VE-3` |
| `src/adapters/surface.ts` | v2 §6 G3, §11 |
| `src/run/version.ts` | `NFR-8`, QA8 |
| `src/runner/agent.ts` | v2 §13.10 |
| `src/web/server.ts` | v2 §7 P1-P7 |
| `src/web/app-ui.ts` | v2 §7 P1-P7 |
| `src/web/registry.ts` | v2 §7 P1 |
| `src/index.ts` | `NFR-3`, QA9 |

**Convention.** The anchor is the file's first line (after a shebang), in the
form `// Spec: <ids> - see spec/traceability.md`. Modules under `src/studio/`
and `src/respec/` additionally describe their spec section in prose in the
lines that follow. Grep the whole set with:

```sh
grep -rn "^// Spec:" src
```

A module implementing a requirement without an anchor is a traceability
defect, the same as a requirement with no trace row.
