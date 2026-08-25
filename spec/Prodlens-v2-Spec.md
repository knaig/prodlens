# Prodlens v2 Spec: Self-Serve Frontend, HITL Pipeline, Demo + QA + Architecture Engines

**Status:** Operative - **Spec revision:** 4 - **Last updated:** 2026-08-25
**Owner:** Karthik
**Spec root:** [README.md](README.md) - **Baselines:** [Prodlens-Product-Spec.md](Prodlens-Product-Spec.md), [Prodlens-Technical-Spec.md](Prodlens-Technical-Spec.md) - **Types:** [schemas.md](schemas.md) - **Status of every requirement:** [traceability.md](traceability.md) - **Adapters:** `docs/adapters.md`

> **This is the operative spec.** It wins over the v1 Product and Technical
> specs wherever they overlap; the exact supersession list is
> [README §2.2](README.md#22-what-v2-supersedes-explicitly).
>
> Type contracts in this document are prose sketches for readability.
> [schemas.md](schemas.md) is normative for every type.
>
> Not everything here is built. Each use case, gate, and phase carries an
> implementation status in [traceability.md](traceability.md), and every known
> spec-ahead-of-code divergence is named in its §6. Spec ahead of code is
> legal; silence about it is not.

**Revision history**
| rev | date | change |
| --- | --- | --- |
| 1 | 2026-08-21 | initial: self-serve frontend, HITL pipeline, demo/QA/architecture engines |
| 2 | 2026-08-21 | personas and use cases, QA engagement, reverse-spec, architecture walkthroughs |
| 3 | 2026-08-25 | §4.3 rewritten transport-agnostic; spec set given a root index, normative schemas, and a trace matrix; §12.3 marked superseded by §13.10 |
| 4 | 2026-08-25 | §4.3 session contract implemented end to end (bridge, reference adapter, VoicEra adapter); Video 2 no longer requires the live voice backends |

## 1. Problem

Prodlens today is a single-operator CLI. The web UI (`prodlens web`) only runs
walkthrough/demo video modes, has this machine's paths and credentials baked
into the form, keeps jobs in memory, and exposes none of the verification
pipeline. Demo generation understands screens, not the product: vision docs are
passed as file paths the LLM never reads. Narration, journeys, and scene plans
are take-it-or-leave-it between CLI runs.

Target: any user points prodlens at their project (repo + running URL + an
existing account) and drives everything from the browser - verification, demo
production, and architecture explainers - with a human decision gate at every
step.

### 1.1 Product-agnostic principle

Prodlens is a platform; VoicEra is ONE tenant of it - the reference product
used for examples and acceptance in this spec because it exercises every
capability (web UI, live voice, Indic localization). The rule, inherited from
`docs/adapters.md` and enforced throughout: **the engine, DSL, pipeline, and
web app contain zero product-specific knowledge.** Everything
product-specific lives in exactly three places: the project registry entry
(URLs, auth), the product's adapter (`<repo>/prodlens/adapter.mjs` -
primitives, scene types, resources), and the product's own artifacts
(respec, vision.md, graphs). Any feature in this spec that only works for
VoicEra is a spec violation. Where this document says "voicera", read
"reference product example".

## 2. Personas and use cases

Prodlens serves three primary personas. Every feature in this spec must trace
to at least one use case below.

### 2.1 Product manager / founder ("show the product")

| # | use case | prodlens flow |
| --- | --- | --- |
| PM1 | Feature-tour video for a prospect deck: login on camera, key screens, value-prop narration | Demo studio: `login` + `screen` scenes from an approved scene plan |
| PM2 | Localized demo: same tour, narration voice/accent/language per market (e.g. Indian English, Hindi) | `voice` block in DemoSpec (backend/name/style), localization gate for captions |
| PM3 | Demo on live data: record against a staging/prod URL with an existing account so screens are populated, not empty | Live-URL auth (Section 7), populated-account project config |
| PM4 | "What changed this release" demo: re-render only the scenes touching changed screens | Screenplay is per-scene timestamped; render gate re-renders changed scenes only |
| PM5 | Live-capability demo: show a real voice call / real API action, not just UI | `call` scene + adapter primitives (Section 4); artifact scenes replay recording + transcript |
| PM6 | Architecture summary in a demo: one 30-60s "how it works" diagram scene inside a product video | Summary-tier diagram scene (Section 5) |
| PM7 | Hand the narration to a human voice artist | Silent twin + timestamped screenplay.md (exists today) |
| PM8 | Bring your own script: hand prodlens a written narrative ("open on login, then show how a support manager sets up a Hindi agent and takes a live call...") and get a demo video that satisfies it | Script layer (Section 4.2) |

### 2.2 QA engineer ("trust the product")

How QA engages with prodlens - the verification pipeline is their primary
surface, in the web app, per project:

| # | use case | prodlens flow |
| --- | --- | --- |
| QA1 | Nightly/PR regression sweep: is every screen reachable, every button wired? | `scan` + `discover` stages; non-zero exit -> CI red; report card in web UI |
| QA2 | Plan and gate the critical journeys before executing them | `prioritize` -> journey review gate (approve/reject/edit goals) - QA owns this gate |
| QA3 | Execute approved journeys against a live build, with form-fill scenarios | `run` stage (InputScenarios grounded on edges), path pass/fail per journey |
| QA4 | Triage findings: real bug vs crawler artifact vs env failure | Report view: severity-ranked issues, per-issue evidence (screenshot, call log), triage actions (confirm / false-positive / env) that feed GEPA |
| QA5 | Visual QA: blank screens, endless spinners, clipped layouts, NaN-type render bugs DOM checks can't see | `visual` stage (vision LLM over screenshots), folded into the report |
| QA6 | Produce a bug reel: one narrated video walking every confirmed defect, for the fix ticket / standup | Demo studio seeded from confirmed issues: one `screen` scene per bug (this session's bug-reel is the prototype) |
| QA7 | Reproduce one flow on demand ("show me exactly how it broke") | Re-run single journey with recording on; artifact browser holds the clip |
| QA8 | Track quality across builds | Run history per project (`runs/v0.n`), verdict badges, diff view between runs |
| QA9 | Gate a release in CI | Headless pipeline via CLI (exists); web app shows the same runs (jobs persisted) |

QA-specific requirements this adds: triage verdicts stored per issue and fed
to GEPA reflection; issue -> bug-reel-scene generator; run-to-run diffing in
the UI; every issue links its evidence artifacts.

### 2.3 Engineer / DevRel / new team member ("understand the product")

| # | use case | prodlens flow |
| --- | --- | --- |
| ENG1 | Onboarding tutorial: professor-style walkthrough of the architecture, 5-15 min | Tutorial-tier diagram walkthrough (Section 5) |
| ENG2 | "Life of a request/call" scenario explainer | Scenario walkthrough over the detailed diagram (Section 5.3) |
| ENG3 | A written spec of what the code actually does today | Reverse-engineered spec artifact (Section 3) |
| ENG4 | Keep docs honest: diff the reverse-spec against the written docs/vision | Reverse-spec gate shows drift between `vision.md`, `docs/`, and code-derived spec |

### 2.4 The consumer: audience personas (who WATCHES)

Sections 2.1-2.3 are makers. Every video also has a consumer, and the
consumer - not the maker - determines length, depth, language, tone, and what
gets cut. v2 makes the audience a first-class modeled input:

- `vision.md` (gate 1) defines the project's **audience personas**: who they
  are, what they already know, what decision or ability the video should
  leave them with, attention budget, language/accent, and accessibility needs
  (captions always/never, reading speed).
- Every `DemoSpec` declares `audience: "<persona-id>"`. The compiler uses it
  to pick defaults - scene count and pace, diagram tier, narration register,
  voice/language, caption channel - and the scene-plan gate warns when a
  scene violates the audience contract (e.g. a 4-minute internals dive in a
  prospect video).

Reference audience personas (projects override in vision.md):

| id | who | wants | contract |
| --- | --- | --- | --- |
| `prospect` | evaluating buyer, low context, low patience | "should I care?" | <= 3 min, outcomes not mechanics, summary diagrams only, polished voice |
| `executive` | sponsor/investor | "is this real and differentiated?" | <= 90s, one scenario traced once, numbers on screen |
| `new-user` | just signed up, needs to succeed once | "how do I do X?" | task-scoped, every click visible, no architecture |
| `operator` | support/field staff being trained (e.g. VoicEra campaign operators) | "how do I run this daily?" | localized narration + translated captions, repetition OK, real populated data |
| `new-engineer` | joining the team | "how does it work inside?" | tutorial-tier diagrams, scenarios, code-honest (respec-grounded) |
| `bug-audience` | the dev fixing it / standup | "what exactly is broken?" | evidence-first, no polish, timestamps + repro steps |

The audience persona is also the review lens: gate reviewers are shown the
audience contract next to the storyboard ("you are editing a video for
`operator`: Marathi captions required").

## 3. Reverse-engineered spec (code -> spec)

New pipeline stage `respec`: prodlens reads the repo and writes what the
product actually is, as a reviewable artifact. This is the missing "product
understanding" layer - the demo engine, QA prioritization, and diagram engine
all consume it.

- **Inputs**: repo source (routes, services, data models, configs,
  docker-compose), discovery graph (real screens/edges), doc contents
  (SUMMARY-aware ingestion - fixes today's paths-only gap in `surface.ts`),
  and `vision.md` when present.
- **Output**: `data/projects/<app>/respec/spec.md` + `spec.json`:
  - product one-liner and inferred goals
  - personas implied by the auth model and screens
  - capability inventory: each feature, the screens/API routes/services that
    implement it, and its data entities
  - service topology: components, ports, protocols, external providers
    (voicera example: Next.js :3200 -> FastAPI :8000 -> MongoDB/MinIO;
    pipecat :7860 -> STT/TTS/LLM providers; Vobiz/Plivo webhooks)
  - key flows as sequences (login, create-agent, inbound call, batch run)
  - drift report: claims in docs/vision not found in code, and code
    capabilities absent from docs
- **HITL**: respec is a gate (Section 6). Humans correct wrong inferences;
  corrections persist as annotations that survive re-runs (re-respec merges,
  never clobbers, human notes).
- **Consumers**: vision gate seeding, journey prioritization prompts, scene
  drafting, and - directly - the diagram engine below.

## 4. Authoring model: script -> scenes -> choreography

This is deliberately the movie-making pipeline, and the spec owns the
metaphor - it gives every artifact and gate a name people already understand:

| film | prodlens | who plays the role |
| --- | --- | --- |
| treatment / brief | `vision.md` + `audience` | producer (PM) |
| location scout + fact check | discovery graph + respec | prodlens (QA verifies) |
| screenplay | `script.md` | screenwriter (human or LLM-seeded) |
| shot list / storyboard | `demo-spec.json` scenes | director at the scene-plan gate |
| choreography / blocking + score | `choreography.json` (narration, cursor, animation, camera tracks) | director + editor at the render gate |
| actors | the live product driven by Playwright + adapters | - |
| voice talent | TTS backends or the silent-twin human handoff | PM7 |
| dailies -> final cut | silent draft render -> per-scene re-render -> final | render-review gate |

The consequence of the metaphor is the discipline: no stage skips ahead (no
render without an approved storyboard), every stage's output is a reviewable
artifact, and the director's edits are pinned, never overwritten by a
regenerate. The one place prodlens is unlike film: the actors never miss a
mark twice - choreography is deterministic and replayable.

Three first-class artifacts, each versioned in the project dir, each with its
own gate. This is the spine of the demo product; everything in Sections 4-5
hangs off it.

| layer | artifact | answers | authored by | gate |
| --- | --- | --- | --- | --- |
| Script | `script.md` | what story is being told | human (PM8) or LLM seed from vision+respec | scene-plan gate shows beats side-by-side with scenes |
| Scenes | `demo-spec.json` | what happens: which screens, calls, diagrams, in what order | compiled from script, or hand-built in the storyboard | scene-plan gate (5) |
| Choreography | `choreography.json` (per scene) | when and how: the unified timeline | compiled from scenes + pre-synthesized narration durations | render-review gate (8) edits it directly |

**Choreography is the render contract.** One timeline per scene, four
synchronized tracks, all in seconds from scene start:

```jsonc
{
  "sceneId": "inbound-call-walkthrough",
  "durationSec": 42.5,
  "tracks": {
    "narration": [ { "at": 0.4, "clip": "n1.wav", "dur": 6.2, "text": "..." } ],
    "cursor":    [ { "at": 0.4, "to": "el:pipecat", "glideMs": 600 } ],
    "animation": [ { "at": 1.1, "target": "edge:vobiz->pipecat", "effect": "draw" },
                   { "at": 2.0, "target": "dot", "effect": "travel", "path": ["vobiz","pipecat","stt"] } ],
    "camera":    [ { "at": 12.0, "effect": "zoom", "target": "el:pipecat", "scale": 2.2 } ]
  }
}
```

Normative definition: `SceneChoreography` in [schemas §5.4](schemas.md).

Properties that make it first-class rather than an internal detail:

- **Inspectable + editable**: the render-review gate renders the timeline as
  tracks (like a video editor); nudging a cursor arrival or delaying an
  animation edits this file, not code. Regenerate never clobbers human edits -
  human-touched entries are pinned, recompile fills around them.
- **Deterministic**: same choreography + same app state -> same video. This is
  what beat-level caching and "re-render only changed scenes" key on.
- **Renderer-agnostic**: `screen` scenes consume narration+cursor tracks
  (animation track empty); `diagram` scenes consume all four; a future
  renderer (e.g. live-trace replay) emits the same format.
- **The screenplay is its projection**: today's timestamped `screenplay.md` /
  `.json` becomes a human-readable view generated FROM choreography, keeping
  the existing voice-artist handoff (PM7) intact.

Today's `explain` cursor-keyframe format (`data/tutorial/
tutorial-screenplay.json`) is the embryo of this file - v2 formalizes it,
extends it with animation + camera tracks, and applies it to every scene type.

### 4.1 Scene DSL (the generic demo spec)

One `DemoSpec` describes any video. It must cover the acceptance videos in
Section 9 and use cases PM1-PM7 without per-video engine code.

```jsonc
{
  "version": 2,
  "title": "...",
  "projectId": "voicera",           // project registry key
  "baseUrl": "http://localhost:3200",
  "audience": "prospect",           // AudiencePersona.id (§2.4)
  "frame": "before-after",          // StoryFrame.id (§4.6)
  "language": "en",
  "voice": { "backend": "gemini", "name": "Kore", "style": "Indian English accent" },
  "scenes": [ /* Scene2[] */ ]
}
```

Normative definition: `DemoSpec2` in [schemas §5.2](schemas.md).

Scene types (discriminated union on `type`):

| type | purpose | key fields |
| --- | --- | --- |
| `screen` | click-through UI scene (today's demo step) | `click/goto/fill/scroll/settleMs/narrate` |
| `login` | credentials typed on camera | `maskPassword: true`, uses project auth config |
| `call` | live interactive session (e.g. a voice conversation) | `sessionKind`, `turns: [{speaker, text?, bargeIn?}]` - transport-agnostic, executed by the project's adapter (§4.3) |
| `artifact` | show a produced artifact | `kind: transcript\|audio\|json\|log\|screenshot`, `source: <scene-id>.<artifact>`, `overlay: translation` |
| `diagram` | narrated architecture/flow walkthrough | `tier: summary\|tutorial`, `scenario?`, `focus?` - full contract in Section 5 |
| `card` | title/value-prop burn-in | `title`, `tagline`, `narrate` |

Caption channels, per scene: `captions: "narration" | "transcript" |
{ "translate": { "from": "mr|bhi|...", "to": "en" } }`. Translations are
LLM-drafted, stored in the screenplay, human-edited at the localization gate.

Existing machinery this builds on, not replaces: `mockWebSockets` (simulated
voice sessions), `mockRoutes`, per-step TTS pre-synthesis, silent twin +
timestamped screenplay, `--os-cursor`, DOM cursor overlay.

### 4.2 Script layer: script-to-demo compiler (PM8)

Input is a human-written script - prose, bullet beats, or a voice-over draft;
no knowledge of scene types, selectors, or the DSL required. Prodlens compiles
it into a `DemoSpec` that satisfies it:

1. **Beat extraction.** LLM splits the script into ordered beats, each with
   intent ("show login", "plug in a custom model", "take a live call in
   Hindi") and any verbatim narration the author wants kept (quoted lines are
   preserved word-for-word; unquoted intent may be rewritten).
2. **Grounding.** Each beat is resolved against the discovery graph + respec:
   which screen, which real edges/clicks reach it (BFS over the graph - same
   grounding rule journeys already use: every step is a real edge, so the
   result replays deterministically), which scene type fits (`screen`,
   `login`, `call`, `diagram`, `artifact`). Fill data comes from
   InputScenarios; named entities in the script ("agent called Priya") become
   fill values.
3. **Gap report.** Beats the product cannot satisfy are not silently dropped:
   each gets a reason (screen not found / action not wired / resource blocked
   - e.g. voice backend down) and a suggestion (nearest satisfiable
   alternative, or the resource to supply). The author decides: cut the beat,
   accept the alternative, or supply the resource.
4. **HITL.** Output lands in the scene-plan gate (gate 5) like any other
   draft, with each scene back-annotated to the script beat it satisfies -
   the storyboard shows script text and scene side by side, so review is
   "does the video match my script", not "read this JSON".
5. **Render.** Standard pipeline from there (localization -> resources ->
   render review). Re-editing the script re-compiles; unchanged beats keep
   their approved scenes (beat-level caching keyed on beat text + grounding).

Fallback when grounding is ambiguous at run time: guided mode
(`script.guided`, exists today - a vision LLM picks the next step from the
live screenshot) executes the beat's intent instead of a pre-resolved click,
and the resolved steps are written back into the spec for deterministic
replay next time.

### 4.3 The `call` scene contract

> **Status: implemented.** `Scene2` carries only `sessionKind` + `turns`, and
> `src/studio/render.ts` delegates execution to the adapter that declares the
> op. Two adapters implement one: the DOM-chat reference
> (`src/adapters/session-dom-adapter.ts`) and VoicEra's
> (`voicera_mono_repository/prodlens/adapter.mjs`), which scripts the
> WebSocket its browser test dialog speaks. Both are covered by tests that need
> no product backend running.

- Transport-agnostic at the Scene2/compiler level: a call/session scene
  carries only `sessionKind` (free text, e.g. "voice-call") and a `turns`
  script (`{speaker, text?, bargeIn?}[]`) - never a specific protocol, WS URL,
  or audio format. Concrete execution is ALWAYS delegated to the project's
  resolved ProdlensAdapter (`src/adapters/types.ts`, registry in
  `src/adapters/engine.ts`'s `registerAdapter`/`selectAdapters`) via
  `adapter.execute({op: <adapter-defined>, args: {turns, ...}}, ctx)` - core
  (`render.ts`/`demo.ts`) never hardcodes a product's transport.
  (Reference adapter: voicera's, driving `test-browser-dialog.tsx`'s WS
  contract via a WS-mock + TTS'd audio + fakeMicWav. A video-calling
  product's adapter would satisfy the same sessionKind/turns contract via
  WebRTC/video-frame mocking instead; a chat product's via DOM manipulation -
  same scene contract, different adapter internals.)
- Mic input (voice adapters): Playwright `--use-fake-device-for-media-stream
  --use-file-for-fake-audio-capture=<wav>`; multi-turn via queued WAVs.
- Barge-in: a `turns[].bargeIn` entry truncates the prior speaker's audio
  mid-word (voice adapters reuse demo.ts's `speakCutAtSec`) - a genuine
  interruption, not a scripted pause.
- recordVideo is silent; call audio enters the final mix from the adapter's
  own captured/synthesized turn audio, aligned to the screenplay.
- Scene outputs into the artifact store: `recording.wav`, `transcript.json`,
  `translation.json` - addressable by later `artifact` scenes.
- Adapter/voice backend down -> scene skipped with a screenplay note
  (blocked-resource policy), never a crashed render.

### 4.4 Narration layer (the voice is the product)

In every persona's use case the narration IS what the consumer actually
receives - the screens illustrate it. It gets its own artifact and gate-level
treatment, not just strings inside scenes:

- **Artifact**: `narration.json` - every line has a stable id, the scene/beat
  it belongs to, and per-language variants. Scenes and choreography reference
  line ids; editing a line never touches scene structure. The screenplay.md
  handoff (PM7) is generated from it.
- **Register**: tone/vocabulary/person derived from `vision.md` + the
  audience persona (2.4) - `prospect` gets benefit-first second-person,
  `new-engineer` gets precise mechanism language, `operator` gets imperative
  task language. Register is a named, reviewable property of the DemoSpec,
  and the drafting prompt enforces it per line.
- **Consistency**: one narrative voice across scenes - terminology locked to
  a per-project glossary (seeded from respec entity names, human-extendable):
  the same feature is never "agent" in scene 2 and "assistant" in scene 5
  unless the product itself is inconsistent (then the drift report says so).
- **Pronunciation lexicon**: per-project phonetic hints for product names,
  brand words, and non-English terms (critical for Indic content) - applied
  to whichever TTS backend renders, and included in the voice-artist handoff.
- **Casting**: `voice` (backend/name/style/language) is casting, chosen per
  audience persona; style prompts (e.g. accent) are first-class fields, not
  CLI hooks. Multi-voice is supported per line (narrator vs quoted user vs
  agent playback in `call`/`artifact` scenes).
- **Pacing as a contract**: target words-per-minute per audience; the
  compiler warns when a line cannot be spoken inside its scene's visual
  window (or stretches the choreography to fit, director's choice at the
  render gate). Deliberate silence is expressible - a beat with no line is a
  choice, not a gap.
- **Localization**: language variants of a line are siblings under the same
  id, so a re-voiced Marathi render reuses identical scenes and choreography;
  the localization gate (6) edits variants, never structure.
- **Review**: narration is editable at BOTH the scene-plan gate (story order,
  what each line claims) and the render gate (delivery: pacing, emphasis,
  pauses). Factual grounding rule: any line making a product claim should be
  traceable to a respec entry - ungrounded claims are flagged for the
  reviewer, same as ungrounded diagram elements.

### 4.5 Presenter presence and delivery styles (anti-gimmick clause)

Narration has a voice (4.4); presence is how embodied that voice is on
screen. It is a dial gated by audience persona and the project's brand kit -
never a default aesthetic:

| level | what appears | allowed audiences |
| --- | --- | --- |
| `none` (default) | voice + cursor + choreography only - the professor effect is the embodiment | all |
| `chip` | small still avatar bubble at act transitions and key beats, then hides; no lip-sync | `new-user`, `operator`, tutorials |
| `guide` | recurring cartoon/character presenter | training content only (`new-user`, `operator`), brand-kit opt-in required |

Rules: lip-synced characters are out of scope (uncanny + gimmick threshold);
`prospect`/`executive`/architect specs reject `chip`/`guide` at the
scene-plan gate as an audience-contract violation; a `guide` must come from
the project's brand kit (prodlens ships none - a mascot is a product asset,
not a platform asset).

Delivery styles that raise narration quality without decoration (all
expressible in narration.json + choreography today):

- **Dialogue mode**: two cast voices, interviewer + expert Q&A, per act or
  whole video - uses 4.4 multi-voice casting.
- **Diegetic narration**: the product speaks for itself - a `call` scene's
  live agent audio carries the act, narrator silent. For voice products this
  is the strongest possible demo statement.
- **Rhetorical beats**: question -> deliberate pause -> reveal; silence is a
  scheduled choreography entry, not a gap.
- **Chapter cards + recaps** for tutorial tier.
- **Sound design, restrained**: soft transition cues, one brand sting on the
  intro card, never music under speech. All cues live on a choreography
  `audio` track entry, reviewable like everything else.

### 4.6 Story frames (what kind of story, for whom)

Narration is storytelling, and different audiences respond to different KINDS
of story. A **story frame** is a named narrative archetype: an act structure
the script compiler fills with product-specific beats. The frame sits between
audience and script: `vision.md` names the audience, the audience suggests a
default frame, the script author (human or LLM) can override it, and the
storyboard displays scenes grouped under the frame's acts so reviewers see
the story shape, not just a scene list.

Frame library (extensible per project; each entry defines acts, audience fit,
and the scene types that realize it):

| frame | shape (acts) | natural audience | realized mostly with |
| --- | --- | --- | --- |
| `before-after` | the painful old way -> the product moment -> the new normal | `prospect` | `card`, `screen` |
| `why-now` | market shift -> what we built -> proof it works -> what it unlocks | `executive` | `card`, summary `diagram`, one `call`/`artifact` proof scene |
| `first-success` | goal -> guided steps -> visible win ("you just did X") | `new-user` | `login`, `screen` |
| `day-in-the-life` | morning task -> the tool in the loop -> end-of-day outcome | `operator` | `screen`, `call`, localized narration |
| `life-of-a-request` | an input enters -> follow it through every component -> it comes out transformed | `new-engineer`, architects | animated sequence/architecture `diagram` + interleaved live scenes |
| `design-decision` | the constraint we faced -> options considered -> why this architecture -> the tradeoff we accepted | architects, senior eng | `diagram` (tutorial tier), respec drift/annotations as source |
| `what-if-it-breaks` | steady state -> component fails -> how the system degrades/recovers | architects, SRE-minded | animated `diagram` (failure path highlighted), respec failure notes |
| `scale-story` | 1 user -> 1,000 -> population scale: what changes at each order of magnitude | `executive`, architects | `diagram` with camera track, metrics `artifact` scenes |
| `detective` | symptom -> clues -> reproduction -> culprit | `bug-audience` | `screen` repro scenes, evidence `artifact` scenes (the bug reel's natural frame) |
| `evolution` | v1's shape -> what broke -> today's shape (and why) | new team members | `diagram` sequence, git/respec history as source |

Technical stories are first-class here, not an afterthought: an architectural
audience gets `life-of-a-request`, `design-decision`, `what-if-it-breaks`,
`scale-story` - all grounded in the respec (the payload's path, the failure
edges, the tradeoffs) so the story is checkably true, not marketing with
diagrams. `design-decision` in particular consumes human annotations from
the respec gate ("we chose Mongo over Postgres because...") - the one story
source code alone cannot provide.

Mechanically: a frame is data - act list, per-act guidance prompt, allowed
scene types, default audience (`StoryFrame`, [schemas §5.5](schemas.md)).
Reference frames ship as the `FRAMES` constant in `src/studio/types.ts`;
externalizing them to per-project `frames/*.json` so a project can add its own
is specified but not yet built (traceability `D-FRAMES-1`). The
script-to-demo compiler
(4.2) tags each extracted beat with an act; drafted-from-scratch scripts are
generated act-by-act. The scene-plan gate shows act headers in the
storyboard; an act with no scenes is surfaced as a story hole ("your
`before-after` has no 'before'").

## 5. Architecture diagram engine ("the professor")

Prodlens already renders mermaid -> PNG diagram slides from real discovery
data (`src/adapters/diagrams.ts`) and already renders narrated videos where a
cursor sprite glides between keyframes on a slide (`explain` cursor keyframes;
see `data/tutorial/tutorial.mp4` and `voicera-tutorial.mp4` - the cursor
points at each service as it is narrated). v2 turns these two primitives into
a first-class engine.

### 5.1 Diagram authoring (Claude/LLM-drafted, ground-truthed)

- Diagrams are DRAFTED by the LLM from the **reverse-spec** (Section 3), not
  from free imagination: components, ports, edges, and flows must reference
  respec entries. A diagram element with no respec anchor is flagged at review.
- Rendered via mermaid -> SVG -> PNG (exists); v2 adds: component grouping
  (frontend/backend/data/providers lanes), edge labels (protocol + port),
  entity badges, and a stable layout seed so re-renders don't reshuffle.
- Every element carries an id + bounding box in a sidecar
  `diagram.layout.json` - this is what lets narration point at things.

### 5.2 Two tiers

| tier | audience | length | content |
| --- | --- | --- | --- |
| `summary` | demos (PM6), pitch decks | 30-90s, one slide | 4-7 boxes, the one-sentence role of each, one happy-path flow traced once |
| `tutorial` | onboarding, DevRel (ENG1) | 5-15 min, multi-slide | full topology, per-component deep dive slides, data model card, failure/scale notes, scenario traces |

Same source diagrams, different zoom: tutorial tier may render per-component
sub-diagrams (one service expanded, rest greyed).

### 5.3 Professor walkthrough (animated, cursor-led)

Diagram scenes are ANIMATED, not static slides. Today's `explain` composites a
cursor sprite over a fixed PNG; v2 instead renders the diagram as a live
SVG/HTML page in the recording browser and records it with the exact machinery
demos already use (Playwright recordVideo + the DOM cursor overlay). The
diagram is a web page, so the whole demo toolchain applies unchanged.

- **Animation timeline synced to voiceover.** Narration clips are
  pre-synthesized (existing), so every clip's duration is known BEFORE
  recording. The scene compiler emits a JS timeline on the diagram page:
  progressive disclosure (elements fade/slide in the moment their narration
  starts, future elements dimmed), edge tracing (animated stroke-dashoffset
  "current" flowing along the edge being described), highlight pulses on the
  active element, scenario payload dots traveling hop-to-hop, and
  zoom/pan (tutorial tier zooms into one service while the rest greys out).
- **Cursor over the animated part.** The overlay cursor glides to each
  element's `layout.json` box as its narration plays and follows traced edges
  mid-animation - pointer, reveal, and voice hit together, like a professor at
  a whiteboard. Keyframes are generated from the timeline, not hand-authored;
  the scene-plan gate lets a human nudge them.
- **Teaching order** drafted per element from the respec ("This is the pipecat
  voice server. Every live call runs through it: audio frames arrive over a
  websocket...") - context -> components -> connections -> scenario.
- **Scenarios** (ENG2, PM5 support): a scenario = an ordered path through the
  diagram with per-hop narration, e.g. voicera "life of an inbound call":
  Vobiz webhook -> pipecat -> STT (Bhili) -> LLM -> TTS -> caller, then
  recording -> MinIO, transcript -> MongoDB -> History screen. Animated as a
  dot traveling the path while each hop narrates. Drafted from respec
  key-flows, human-edited at the scene-plan gate. Tutorial tier walks
  scenarios hop by hop; summary tier traces one in a single pass.
- Tutorial videos may interleave `diagram` scenes with live `screen`/`call`
  scenes ("here it is on the diagram - now watch it in the product").
- Static PNG export of every diagram state is kept as a byproduct (decks,
  docs, README embeds).

**Animation vocabulary per diagram kind** (all recorded live off the SVG
page - real motion, not slide transitions):

| kind | animated primitives |
| --- | --- |
| sequence | message arrows draw themselves as narrated; a payload dot travels along each arrow; lifeline activation bars grow while a service "processes"; response arrows animate back; future messages dimmed, past settled |
| architecture | scenario dot travels hop-to-hop across services; edges pulse while described; zoom/pan into one component (rest greyed) |
| flowchart | edge-flow pulses along the described path; branch taken brightens, branch not taken dims |
| state | active-state highlight hops transitions as the narration walks them |

Honest constraint: this is choreography, not simulation - motion is scripted
from respec key-flows and synced to narration; it does not replay live
traffic. Future tier: drive the sequence dot from a real trace (e.g. the
`call` scene's HAR/timeline) so the animation replays an actual recorded
interaction. Renderer note: mermaid's generated SVG is hostile to element
addressing/animation; summary tier may keep mermaid, but sequence and
tutorial-tier diagrams get a prodlens-owned SVG renderer over respec data
(stable ids, layout sidecar by construction).

### 5.4 Diagrams v3: event-log projection architecture (adopted brief, 2026-08-21)

Supersedes the v2 renderer internals (5.2/5.3 remain the product behavior;
this is how they are built from here on). Core principle: **every diagram is
a view over an event log we already produce** (choreography tracks, respec
flows, crawler/executor logs, judge outcomes) - the renderer projects the
log; it never hand-authors a picture and animates a camera over it.

- **Module**: `diagrams/` - shared schema (`TraceEvent {t, from, to, label,
  narration?, judgeScore?, meta}` + `Actor {id, displayName, role}` for
  time-based views; a distinct `StaticGraph {nodes, edges}` for timeless
  views - never fake `t:0` onto static data).
- **Five renderers, routed by data shape, kept separate**: structural
  (static system map - no camera pans, no glow-on-a-timer; too many nodes =
  split the view), sequence (one run's messages: fixed lifelines, arrows
  that DRAW along their path with the arrowhead revealed only after the line
  completes; judge-score badges), state-machine (aggregate over many runs:
  transition frequency edge weights), deployment (static nested containers
  with the trust/egress boundary explicit), activity/flowchart (pipeline
  stages + gates - not actors, so never forced into a sequence diagram).
- **Layout**: elkjs for every node/edge diagram; box sizes measured from
  text (kills the truncation bug). No hand-placed coordinates, no
  force-directed second engine.
- **Render shell**: Remotion - one React component tree is BOTH the
  scrubbable interactive artifact (@remotion/player / Studio timeline) and
  the exported MP4, so the verification artifact and the narrated demo are
  provably the same run. interpolate()/spring() easing.
- **Playback**: every time-based diagram gets a scrubber (step backward is a
  review requirement); autoplay is a convenience on top, never the only
  interface.
- **Narration**: pluggable TTS provider interface; concrete provider is the
  existing Gemini styled multi-voice cast (per-actor voices - persona/agent/
  judge/component each keep their own voice; style prompts preserved).
  `narration` is authored separately from `label` (never read the terse
  label aloud). Audio pre-generated per event; measured durations drive
  per-step timing (no fixed timers). Browser speechSynthesis: prototyping
  only, never in the export path.
- **Captions**: every narrated step renders its spoken text on screen,
  synced to the audio (accessibility + sound-off viewing).
- **Non-goals**: no auto-selection of diagram type from free text (callers
  choose the renderer), no physics layout, no camera moves on static views.
- **Build order**: schema+elk+structural (fix truncation) -> sequence
  against a hand-written fixture (lifelines, draw-anim, scrubber) ->
  narration+captions -> Remotion export parity -> real data (respec flows /
  choreography / run logs as TraceEvent[]) -> deployment+activity ->
  state-machine aggregate (needs many traces).

### 5.5 Vision dependency

Diagram narration tone, what to emphasize, and what to omit come from
`vision.md` (gate 1). No vision -> engine still works but narrates neutrally;
the review gate warns that emphasis is ungrounded.

## 6. HITL pipeline (gates, not batches)

Every stage emits a reviewable draft. The web UI blocks the next stage until
the gate is approved. Every gate supports "comment -> regenerate with
feedback" (comment appended to that stage's LLM prompt) plus direct manual
editing. All gate artifacts are files in the project dir - versioned,
diffable, re-runnable.

| # | gate | draft artifact | human actions | primary persona |
| --- | --- | --- | --- | --- |
| 1 | Vision | `vision.md` - goals, personas, key features, do-show/don't-show | write or edit LLM seed; approve | PM |
| 2 | Reverse-spec | `respec/spec.md` + drift report | correct inferences, annotate, approve | Engineer |
| 3 | Surface | `surface.json` summary (screens, components, docs found) | correct/annotate, exclude noise | QA |
| 4 | Journeys | `paths.json` | approve/reject/edit goals (existing `src/prioritization/review.ts`, web-ified) | QA |
| 5 | Scene plan | `demo-spec.json` storyboard incl. diagram scenes + scenarios | reorder, rewrite narration, set voice/tier, approve | PM |
| 6 | Localization | screenplay translations | edit translated captions | PM |
| 7 | Resources | needs checklist (creds, WAVs, numbers, keys) | supply values; blocked scenes surfaced up front | all |
| 8 | Render review | silent draft render + screenplay | per-scene comments; re-render only changed scenes | PM |
| - | Triage (continuous) | issue list on every report | confirm / false-positive / env verdicts -> GEPA | QA |

## 7. Web app

Extend `src/web/server.ts` (plain node http + SSE, no framework).

### 7.1 UX principles

1. **Draft-first, gate-later.** Paste URL + creds -> prodlens discovers,
   drafts vision/respec/script itself, renders a 60s draft demo unattended.
   The user's first experience is watching their product as a movie
   (~minutes), then improving it through gates - never filling forms before
   seeing value.
2. **Conversation is the front door.** Gates are edited by talking to the
   director ("scene 3 drags, cut it", "more executive tone") - the agent
   edits the artifacts and shows a diff; direct artifact/JSON editing is the
   escape hatch, not the default.
3. **Watch-with-me review.** Comments are made ON the playing video, pinned
   to timestamp + element id (choreography makes both addressable), and
   compile into per-scene regenerate instructions. Review bundles export as
   self-contained HTML (explorer.html pattern) so stakeholders comment
   without installing anything.
4. **Preview without re-render.** Captions, cursor path, animation timing,
   and re-voiced lines preview as browser overlays on the once-recorded
   silent scene - scrub like a video editor; only the final cut re-renders.
5. **Persona-shaped home.** PM lands on "Make a video" (one-click recipes:
   feature tour, release-delta, bug reel from last run), QA on "Verify this
   build", engineer on "Explain the architecture". Gates collapse behind
   smart defaults; one surfaces only when the system is uncertain or the
   user opted into full control.
6. **Provenance on hover.** Every narration claim and diagram element shows
   its source (respec entry, file:line, discovery edge) in place.
7. **Failure UX.** A failed scene shows the exact frame it died on, what it
   was looking for, a suggested fix, and "re-run this scene only".
8. **Honest meters.** Estimated wall time + LLM cost before each stage; what
   was skipped or capped after it.

- **P1 Projects + persistence.** `data/registry.json` project CRUD (name,
  repoRoot, baseUrl, auth strategy, entry paths); per-project gitignored
  `secrets.json` never echoed into HTML; jobs persisted under
  `data/projects/<app>/runs/`. Strip hardcoded personal defaults.
- **P2 Verification pipeline (QA surface).** Stage cards
  scan/discover/prioritize/review/run/report/visual; POST + SSE log per stage;
  verdict badges; issue triage view (QA4) with evidence links; run history +
  diff (QA8).
- **P3 Respec + vision.** `respec` stage + gates 1-2; drift report view.
- **P4 Demo studio (PM surface).** Storyboard editor over `demo-spec.json`
  (gates 5-8), resource checklist, silent-draft -> final render, artifact
  browser (reports, explorer.html embed, video gallery, screenplays),
  bug-reel-from-issues generator (QA6).
- **P5 Diagram engine.** Diagram authoring + layout sidecars, professor
  screenplay compiler, summary/tutorial tiers, scenario editor.
- **P6 Call scenes.** Fake-mic wiring, recording/transcript capture,
  translation captions.
- **P7 Onboarding + sharing.** Preflight checks (URL reachable, login works,
  LLM/TTS keys, ffmpeg/Playwright) with fix hints; localhost default,
  `--host`+token for LAN.

## 8. Auth against a live URL (populated data)

Works today: `--base-url <any-url> --auth custom-login` +
`UX_FLOW_TEST_EMAIL/PASSWORD` (existing account) - heuristic form fill,
storageState cached, login once. Additions:

- `--storage-state <file>` / UI upload: import a session exported from the
  user's real browser. Covers SSO/OTP/2FA. Stored as a secret, gitignored.
- Per-project `signInPath` / `loginButton` overrides (fields exist in
  `AuthConfig`) exposed in project settings.

## 9. Acceptance: five videos as pure specs (reference product: VoicEra)

These use VoicEra because it exercises every capability; the acceptance
criterion for product-agnosticism is that pointing the same pipeline at a
second registered product requires only that product's adapter + registry
entry - no engine changes.

**Video 1 - VoicEra feature tour (PM1/PM2/PM3).** `login` scene -> `screen`
scenes: create-agent wizard (model plugging, greeting setup), integrations,
knowledge base, numbers, history/analytics -> `card` outro. Indian-English
narration.

**Video 2 - Marathi/Bhili live call (PM5).** `card` intro -> `screen` (agent
config with Bhili/Marathi STT-TTS) -> `call` scene: the conversation runs
through VoicEra's real in-browser test dialog, driven by its adapter -> 
`artifact` scenes: transcript bubbles from History, English translation
captions over the call playback.

The agent side is scripted through the dialog's own WebSocket contract rather
than answered by a live model, so the render is deterministic and the `:7860` +
Bhili STT/TTS stack is NOT a prerequisite - which is the difference between a
demo that reproduces and one that depends on a model's mood. Per-turn agent
audio is supplied as WAVs via the adapter's `turnAudio` manifest field.
Remaining for this video: the translation captions, which are gate G6.

**Video 3 - VoicEra architecture summary (PM6).** Single `diagram` scene,
`tier: summary`, scenario "life of an inbound call" traced once, 60-90s -
embeddable inside Video 1.

**Video 4 - VoicEra architecture tutorial (ENG1/ENG2).** `diagram` scenes,
`tier: tutorial`: topology -> per-service deep dives -> data model ->
scenario walkthroughs (inbound call; batch campaign) -> interleaved `screen`
scenes showing each flow live. 8-12 min.

**Video 5 - script-driven (PM8).** A one-page prose script written by a
non-engineer compiles to a rendered demo with zero manual DSL editing; at
least one beat intentionally unsatisfiable, surfaced in the gap report rather
than silently dropped.

All five must render from `DemoSpec` JSON only - if any needs
VoicEra-specific engine code, the DSL has failed (VoicEra specifics belong in
`voicera_mono_repository/prodlens/adapter.mjs` and the respec).

## 10. Build vs integrate (scope protection)

The moat is the grounding layer: verified, code-grounded, deterministically
replayable walkthroughs of the real app, where QA regression and demo
production are the same walkthrough. No market tool does this (NotebookLM
narrates documents, not running software - it cannot click a button, place a
call, or catch docs-vs-code drift; capture tools like Arcade/Storylane need a
human driver and re-recording every release). Everything else is commodity.

**Build** (differentiated, spine of this spec): discovery + verification
pipeline, respec, adapter system, choreography determinism, `call` scenes,
HITL gates, CI integration, diagram grounding.

**Integrate, never build**: TTS voices and dialogue-mode audio (Gemini/
NotebookLM-class APIs), avatar/lip-sync tech (excluded by 4.5 anyway),
post-production editing (silent twin + screenplay hand off to Descript/
CapCut/humans), animation plumbing (existing motion libs), translation
models.

**Bonus integration**: export respec + screenplay as NotebookLM sources -> a
free audio-overview "podcast about your product's architecture" artifact for
the ENG audience (~1 day).

**Decision (2026-08-21)**: prodlens builds its own capture/tour capability -
no third-party demo tools even for feature tours. Every video tier ships on
prodlens rails; the integrate list above is strictly the audio/post
commodity layer.

## 11. Known engine debt this spec assumes fixed

- tsx/esbuild broke Playwright `addInitScript` function callbacks (page-side
  `__name` helper) - cursor overlay invisible under `npx tsx`. Fixed
  2026-08-21 (string-form init scripts in `os-cursor.ts`); keep new init
  scripts string-form.
- `demo --tts-cmd` CLI passthrough added 2026-08-21.
- Crawler false positives: Radix modals set `pointer-events:none` on body;
  crawler must Escape/dismiss between clicks or per-page findings after a
  modal opens are noise. (QA4 triage also mitigates.)
- No Indian voice in built-in TTS backends; Gemini voice + accent style-prompt
  via `--tts-cmd` hook is current best. Promote into a first-class
  `voice.style` field (PM2).
- `src/adapters/surface.ts` doc ingestion is paths-only; respec (Section 3)
  subsumes it with SUMMARY-aware content ingestion.

## 12. SaaS productization

Prodlens ships as a hosted product with pricing, not an internal tool.

### 12.1 Architecture: cloud control plane + optional local runner

- **Control plane (hosted)**: orgs/users/seats, project registry, all HITL
  gates and artifacts (vision, respec, storyboard, choreography, narration),
  run history, artifact/object storage, billing, the admin plane.
- **Runner (where browsers run)**: the discovery/execution/render engine.
  Two deployments of the same code:
  - *Cloud runner* (default): target apps reachable from the internet
    (staging/prod URLs) run with zero install.
  - *Desktop/CI runner* (the justified install): connects OUT to the control
    plane over wss and executes jobs locally. Real advantages, not habit:
    (1) reaches localhost/VPN/pre-release apps no SaaS can see; (2) login
    credentials and storage-state stay on the customer's machine; (3)
    `--os-cursor` real-screen capture is physically local; (4) CI gating runs
    inside the customer's pipeline. This is the Enterprise wedge.
- Everything already built runs unchanged in both: the engine is a Node
  process; the web app's API becomes the control-plane API.

### 12.2 Metering + cost ledger (built 2026-08-21)

The lazy-dist ledger pattern, ported (`src/usage/ledger.ts`):

- Flat per-unit cost ESTIMATES (labeled as estimates): llm $0.002/call,
  vision $0.004/image, tts $0.02/clip, crawl $0.0015/page, execute
  $0.003/step, render $0.06/video-minute, storage $0.0003/MB-month.
- `recordCost` is idempotent per refId per month; events append to
  `data/usage/events-YYYY-MM.jsonl` (maps 1:1 to a DB table when hosted).
- Spend hooks at every cost path: `localChat` (llm/vision), all TTS synth
  paths, discover (pages), run (steps), studio renders (real video minutes).
- Per-project monthly caps (default $25) with a preflight gate: stages refuse
  to start past cap (HTTP 402) - the lazy-dist `preflightBlocked` pattern.
- **Admin page** (sidebar -> Admin): month spend total + per-project spend vs
  cap with budget editing, bucket breakdown, unit economics, pricing tiers
  with margin-at-full-use computed from the same ledger constants - the
  pricing can never silently drift from the costs.

### 12.3 Pricing (launch)

> **Superseded by §13.10.** Quotas are now measured in credits (1 credit ~
> $0.01 COGS), not per-artifact counts, and seats are priced separately. The
> table below is kept for its margin analysis, which still holds because both
> models derive from the same ledger constants (§12.2). `src/web/pricing.ts`
> implements the §13.10 model.

| tier | price | quotas (mo) | margin at full use |
| --- | --- | --- | --- |
| Free | $0 | 1 project, 3 watermarked videos, 10 QA runs | -$3.07 COGS (acquisition) |
| Builder | $49/mo | 3 projects, 20 videos, 100 QA runs, 2 seats | ~47% |
| Team | $199/mo | 10 projects, 80 videos, 600 QA runs, 5 seats, HITL seats + CI gating + call scenes | ~32% |
| Enterprise | custom | unlimited + desktop/CI runner, SSO, audit, custom adapters, SLA | per deal |

Unit economics (from ledger estimates): QA run ~$0.16 COGS, narrated video
~$0.49 COGS. Overages: metered add-ons at ~3x COGS (video minutes, QA runs).

### 12.4 Hosted-gap checklist (not yet built)

Accounts/orgs/seats + auth; Razorpay billing (subscriptions/payment links, INR-first with UPI; webhook-driven plan activation) wired to the ledger's summaries;
artifact object storage + CDN; runner protocol (wss job lease, heartbeat,
artifact upload); org-facing usage page (the admin page today is
operator-facing); quota enforcement per tier (cap enforcement exists,
tier-quota mapping does not); watermarking for Free-tier renders.

## 13. Rev-3 additions (2026-08-21 review feedback)

### 13.1 Deep respec (full reverse-engineering)

Today's respec reads ~15 key files + docs + graph. Deep pass adds: full
import-graph walk per service (bounded per-file summaries -> component
internals), per-component sub-topology (`internals: RespecComponent[]` -
routers, workers, stores inside each service), data entities per store, and
external API calls with endpoints. Runs as `respec --deep` (slower, LLM
map-reduce over the tree). Requires read-only repo access only - never write
scopes (13.5).

### 13.2 Diagram engine v2: levels, sequence, dynamic switching, media

- **Level-of-detail drill-down**: L1 system map -> camera "enters" a
  component -> L2 internals diagram (from deep respec) -> back out. Narration
  drives the camera; every dive/return is a choreography `camera` entry. As
  many levels as respec data supports.
- **Sequence diagrams**: every respec flow renders as an animated sequence
  diagram (lifelines, self-drawing message arrows, traveling payload dot,
  activation bars) - prodlens-owned SVG renderer, not mermaid (mermaid's SVG
  is animation-hostile; we generate our own with stable ids + layout sidecar).
- **Dynamic diagram selection**: the scene compiler picks the diagram kind
  per narration beat - topology for "how it fits", sequence for "what
  happens when", state for lifecycle beats - and may switch mid-scene
  (topology -> zoom -> sequence -> back).
- **Media enrichment**: diagram/tutorial scenes may interleave real product
  screenshots (from discovery - already on disk), UI clip inserts (from
  recorded segments), and generated illustration cards. Internet stock is
  OFF by default: licensing risk + product honesty; a project may opt in
  with an attribution-required asset folder it owns. Never hotlink scraped
  images.

### 13.3 Humanized components ("the cast")

Optional narration mode `cast` for architecture scenes: each component
becomes a character with a distinct TTS voice (multi-voice casting exists in
4.4) and introduces itself - role, responsibilities, limitations, who it
talks to - drafted from the respec (limitations from Limitations docs +
human annotations), loosely conversational, not a rigid template. The
narrator voice anchors transitions ("...and this is where the voice server
takes over - let it tell you itself"). Guardrail: every self-description
claim must trace to a respec entry; the audience contract can veto `cast`
(no talking databases in an executive video unless asked).

### 13.4 Role-first viewing + named personas

- Viewers don't want all screens. Studio's first question: **pick a role** -
  roles come from the respec/vision persona list, with human names (e.g.
  "Priya - Campaign Operator", "Dev - Integration Engineer", "Meera - QA
  Lead"). Picking a role compiles a role-scoped workflow video: only that
  role's screens and journeys.
- The same named personas label the maker UI: journey review shows which
  persona a journey serves; verify stages explain themselves in persona
  terms ("Meera's regression sweep").

### 13.5 Project onboarding (gated, mandatory steps)

A project is not "onboarded" until the wizard completes:
1. **Sources (mandatory)**: product website/live URL; repo location; other
   sources (docs links, notion, anything - free-form list).
2. **Access (optional, read-only enforced)**: repo credentials/token for the
   reverse-engineering pass - request the narrowest read-only scope (e.g.
   GitHub fine-grained token, contents:read only); never write scopes.
   Providing access triggers respec automatically; without it, respec runs
   graph+docs-only.
3. **Verification bootstrap**: first discover run + preflight.
Only then do studio/verify unlock. Onboarding status is visible on the
project card.

### 13.6 Script sources (grounded, three doors)

Studio offers three entry points, all grounded in the respec (a generated
beat that references a capability absent from the respec is a compiler
error, not a gap - gaps are reserved for HUMAN beats the product can't
satisfy):
1. **Write your own script** (exists).
2. **One-liner**: "make a 90-second video convincing a call-center head to
   try us" -> LLM drafts the full script from vision + respec + audience.
3. **Import from lazy-dist**: pull the product's vision/strategy/positioning
   sections via lazy-dist's API as script seeds (integration; lazy-dist is
   the marketing brain, prodlens is the showing brain).

### 13.7 Frames filtered by audience

The story-frame dropdown lists only frames whose defaultAudience matches or
is adjacent to the chosen audience (data already in FRAMES); an off-list
frame is selectable under "advanced" with a contract warning.

### 13.8 Artifact registry (versioned, described, team-shared)

Every produced artifact (video, respec, storyboard, report, diagram) gets a
registry entry: id, version (v1..n, monotonic per artifact name), title,
auto-generated description, creator, source inputs (spec hash, respec
version), created-at. The registry is project-owned and team-visible so a
teammate finds the existing "operator onboarding video v3" instead of
re-rendering it; re-renders of unchanged inputs are flagged as duplicates
before they run.

### 13.9 Console/verify UX clarity

The bottom console names the stage in persona terms and what it means
("Discovering screens - Meera is crawling your app, ~2 min"), shows progress
context, and links its result artifact when done. "Running" states must
always answer: what is running, for whom, how long, what will I get.

### 13.10 Cloud (Vercel control plane + Clerk)

- **Hosting split — DECISION 2026-08-21: cloud-first, not cloud-only.**
  Control plane (Next.js on Vercel): auth, orgs/teams, projects, artifact
  registry + gallery, gates/review, billing, admin, and the runner job queue.
  Runners (browsers/ffmpeg/long jobs) never run on serverless: one runner
  codebase, two deployments - a cloud runner pool on container infra
  (Fly/Railway/ECS) as the DEFAULT for internet-reachable apps (zero-install
  onboarding), and the self-hosted runner for localhost/dev-loop, credential
  residency, and CI gating (Enterprise wedge).
- **Runner protocol v1 (poll-based, serverless-friendly)**: org admin enrolls
  a runner -> HMAC-signed runner token (orgId embedded, shown once). Runner
  polls `POST /api/runner/claim`; executes the job with the local engine;
  streams log batches to `POST /api/runner/jobs/:id/log`; uploads video
  artifacts to Blob storage; finishes via `POST /api/runner/jobs/:id/complete`.
  Jobs + logs + artifacts live in Vercel Blob (store swap-able for Redis/PG
  later). Caveat: a job submitted through the cloud carries target-app
  credentials to the claiming runner - encrypted at rest, and self-hosted
  runners mean those creds only ever land on the customer's own machine.
- **Auth**: Clerk (OAuth Google/GitHub + SAML SSO on Enterprise), Clerk
  Organizations for org/team; joining an org requires moderator (org admin)
  approval; invites by email.
- **RBAC roles**: Owner (billing + members), Moderator (approve members,
  manage roles), Creator (run stages, compile, render), Reviewer (gates:
  approve/reject/edit, triage), Viewer (watch artifacts only). Defaults:
  least privilege; Viewer on join until moderator upgrades.
- **Quotas** (best practice: measure in credits, meter everything): plan
  quotas in credits/month where 1 credit ~ $0.01 COGS; QA run ~16 credits,
  video ~49 credits (from 12.2 unit economics). Per-seat pricing + artifact
  credit packs: Free 500 credits/1 seat; Builder $49 = 2 seats + 5k credits;
  Team $199 = 5 seats + 25k credits, extra seat $15, extra 5k credits $29;
  Enterprise custom. Hard stop at cap (402 pattern, exists) with moderator
  override.

## 14. Sequencing

P1 -> P2 (QA self-serve, ~2-3 days) -> Video 1 (login scene only, ~0.5 day)
-> P3 respec (~1-2 days) -> P4 demo studio (~2 days) -> P5 diagrams + Videos
3/4 (~2-3 days) -> P6 + Video 2 (~2-3 days, gated on Bhili backends) -> P7
(~1 day).
