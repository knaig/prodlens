# Eval Framework & Demo Agent - Brainstorming Record

This doc preserves the design conversation that led from the original
`ux-flow-tester` crawler to the current voicera voice-AI demo/eval agent. It is
a record, not a spec: every decision is captured with the reasoning, so a later
fork can pick up the thread at any point.

## 1. Origin & context

- **prodlens** (this repo) started as `ux-flow-tester`: recover a web product's
  UI as a graph of screens/transitions, verify every edge, prioritize critical
  journeys, execute them, and render narrated demo videos with a real cursor.
- Work on a **2-stage voicera demo** produced verified videos:
  - `stage1-vanilla.mp4` - vanilla app tour (9 steps)
  - `stage2-callflow.mp4` - agent config, barge-in toggle, test call, history
    transcript (12 steps, call endpoint mocked via Playwright route
    interception)
  - Fixes that made them reliable: cursor parks at viewport center per scene,
    per-scene `onProgress`, guessed-selector timeouts 4000ms->2500ms, narrated
    clips carry `durSec` (final-narration trim bug), explicit `narrate: ""` =
    silent step (skip flaky vision auto-narrate).
- Real telephony is NOT available in this environment (voice server :7860 down,
  no Plivo/Vobiz creds). Stage 2 therefore drove the real UI with seeded data +
  a mocked `/api/outbound-call`.

## 2. Loop vs graph - the agentic design decision

- A pure **agentic loop** (ReAct: think -> tool -> observe -> repeat) is simple
  but has no stage progress, no human-in-the-loop gates, and no
  checkpoint/resume. Not enough for a product that must show "step 3 of 5" in
  the UI and pause at prereqs.
- The modern **agentic graph** (LangGraph / AgentKit style) is a directed graph
  of nodes with conditional edges; nodes can be LLM calls, tool calls, or human
  checkpoints. Graph for orchestration, **loop within a node**.
- **Chosen:** a tiny in-repo `Stage[]` executor as the spine, LLM-routed edges
  only at branch points, and a bounded free-agent leaf that catches anything
  unparseable. Mirrors the existing staged CLI (`discover -> prioritize ->
  synthesize -> run -> report`).
- **Three user decisions:** (1) fixed skeleton + free-agent fallback,
  (2) pause at prereqs (human gate), (3) tiny in-repo Stage runner (no LangGraph
  dependency; zero-dep philosophy).

```
[freeform box / CLI]
  -> parse_plan (LLM: instruction -> {target flow, seeds, mocks})
  -> prereq_check (tool probes: telephony? db? llm? ports? creds?)
  -> HUMAN GATE: prerequisites form "you'll need X,Y,Z; mock them?"
  -> scaffold (LLM w/ tools: emit seed.py + demo.json + mockRoutes + prereqs)
  -> verify (LOOP: run generated script -> OCR/step-check -> fail? return, bounded retries)
  -> report (persist artifacts + stage events + video)
  -> free-agent fallback leaf for anything unparseable
```

- **Reuse:** `onProgress(stage, detail)` SSE, commander CLI, `mockRoutes`,
  auto-seed pattern from `seed-demo-data.py`.
- **Extend:** `src/llm/local.ts` currently single-shot with one forced tool; a
  loop node needs a conversation-state client (message history + `tool_calls[]`).

## 3. The `demo subset-of eval` reframe

- **Every demo run is one eval task graded at inference time.** The verify node
  is the grader; the prereq gate is a checkpoint; the crash-build-learn loop is
  the behavior; the agent-graph is the runtime.
- **Video is a human-readable rendering of a passing trace** (`screenplay.json`
  is the machine-readable trace).
- Only two things make prodlens "not-an-eval" today: tasks are bespoke and
  human-graded, and traces/metrics aren't persisted/aggregated across runs.
  Both are scope gaps, not design gaps.
- **Implication:** one engine. Every run = a task. `verify` becomes mandatory
  and machine-gradable. Every run writes `trace.json`. Video is an optional
  renderer over the trace.
- **Three grader strengths (oracle levels):**
  1. Selector-level (cheap): click/drag target resolved, right final screen.
  2. State-level (medium): fixture encodes post-action data (call queued, order
     placed).
  3. Semantic/OCR (costly): vision model reads the final screen.

## 4. Project selection criteria (8 dimensions)

Scored relative to voicera (Next.js + FastAPI + Mongo, Clerk token auth,
telephony-dependent). At least one pick must score high on each diversity axis.

1. **Auth/access diversity** - none/public | password | Clerk | custom-login+token
2. **Backend presence** - frontend-only SPA | full-stack | server-rendered
3. **Data layer diversity** - no DB | SQL (Postgres/Neon/SQLite) | document (Mongo)
4. **External service deps** - none | LLM | search/data APIs | telephony
5. **UI interaction surface** - forms/tables | dashboards/charts | wizards |
   drag-and-drop/modals
6. **Run complexity** - single command one port | multi-service orchestration
7. **Local reproducibility** - boots on this mac, no paid keys to reach core
   screens, no Docker if avoidable (hard gate)
8. **Owned + real-world** - projects we hold, case-study-worthy

## 5. Interaction-type diversity taxonomy (10 dynamic behaviors)

What makes an app's state change over time; each stresses codegen differently.

1. External side-effect calls (telephony, payment, SMS/email, search) - needs
   mocking + creds prereq.
2. Async job / background worker (image/video/report gen, transcription) -
   non-deterministic completion timing.
3. Real-time / streaming (WebRTC/WHIP, websockets, live cursors, streamed LLM
   tokens, live dashboards) - no "done" event; highest nondeterminism.
4. User-driven UI manipulation (canvas drawing, drag-and-drop, rich text, file
   upload, sliders) - non-DOM surfaces, needs mouse-path automation.
5. Complex data-grid interactions (sort/filter/pagination/infinite scroll/bulk) -
   shifting rows, virtualized tables, seeded-data dependence.
6. Multi-step / conditional / wizard flows (onboarding, checkout) - local state
   machine, validation branches.
7. Role / scope / tenant visibility (admin vs user, orgs, approvals) - same UI
   differs per identity; needs multi-user fixtures + RBAC-aware selection.
8. Auth/identity lifecycle (signup, magic-link, OAuth, session expiry) - session
   persistence + token refresh dominate setup.
9. Time / schedule / calendar dependents (bookings, scheduled jobs, TZ) - seed
   data must be time-safe.
10. Appended data feeds (chat, notifications, activity logs) - tail-shifting
    selectors.

voicera covers: 1 (telephony), 6 (agent config/welcome), 7 (org+assistant),
8 (Clerk custom-login), lightly 5 (history). New picks should bring different
PRIMARY types.

## 6. Canonical telephony eval set

- T1 Outbound call -> "queued" status (mock the side-effect).
- T2 Barge-in toggle present + persists.
- T3 Call-history transcript renders chat bubbles from seeded logs.
- T4 In-app harness end-to-end (Dograh Test Chat: build workflow bot ->
  converse -> edit a user turn -> assert regenerated reply + node transitions).
- T5 Repeat/idempotent call short-circuit ("already decided").

## 7. Codegen: static vs dynamic tiers

**Tier 1 - STATIC** (once per app, repo-derived, versioned): the "language"/
conversation protocol (route, envelope, params, ws-auth), turn/reply parse
rules, transcript token format, schema -> seeds + mock map, boot/persistence
recipe, ground-truth spec, timeout/poll defaults. This is the **conversation
adapter**: a per-app file teaching the eval how to speak the language.

**Tier 2 - BOUND** (static structure, runtime values): seed/target IDs, live
ports, auth tokens, fixture values read from live state.

**Tier 3 - DYNAMIC** (per-run, reactive): the utterance sequence (agent replies
are LLM-stochastic), barge-in/interruption driving, reply edge-cases + repair,
assertion arrival detection, retry/selector-fallback.

## 8. Voice-only pivot

- The driver now **speaks as the user** (TTS) and **listens to the agent**; the
  demo captures actual audio interaction, not a POST.
- **Demo script = static beats, narrated storyline; outcomes = dynamic.** Static:
  beat list, narration templates, strategy/intent/expect per beat, guardrail
  config, per-app voice adapter. Dynamic: actual utterances, "what happened"
  enrichment sentences, verdicts, repair decisions at runtime.
- 3-beat starter: (1) simple conversation, (2) barge-in/interrupt mid-reply,
  (3) inject another language. mac `say` ships it_IT/kn_IN/fr_CA/de_DE voices;
  kokoro `n` for en.
- **User-audio injection candidates:** (a) direct WS drive into Dograh's realtime
  pipeline via `ws_auth`/pipecat (deterministic, transcripts for free), or
  (b) Chromium fake-device loopback `--use-fake-ui-for-media-stream` while `say`
  speaks + OS-cursor recording (keeps "real browser" aesthetic, flakier).

## 9. Failure scenario matrix + guardrails

| Scenario | Detect via | Action (never block) |
|---|---|---|
| Silent call / no reply | no 1st audio byte in turnTimeout (~6s) | one re-prompt probe -> silence verdict -> next beat |
| Mid-reply silence | agent audio stalls after start | barge outcome or partialReply |
| No call connects | no media frames in connectTimeout | noAnswer, narrate, continue |
| Infinite loop | same (userText -> agentReply||node) x loopWindow (3) | abort beat, loop verdict, continue |
| Misheard / mis-intent | node != expected or STT off | wanted outcome (lang test), verdict |
| Barge ignored vs ducked | TTS continues vs stops | bargeIgnored / bargeDucked |
| Latency blowup | first-audio > latencyWarn (3s) | annotate, keep beat |
| Media dropped / WS closed | teardown, no frames for watchdog | mediaLost, clean teardown |
| Run budget | turn/beat/wall-clock caps | hard stop, partial video still encoded |

Structural "can't-hang": turnTimeout, connectTimeout, loopWindow,
maxTurnsPerBeat (4), maxRetries (1 rephrase/beat), run-wide turn + wall-clock
caps. Same crash-build-learn loop, now at beat level.

## 10. Sticky decisions + open questions

**Decided:**
- Demo tool is a subset of eval framework; one engine, no fork.
- Agentic graph (graph-of-loops), tiny in-repo Stage runner.
- Human gate at prereqs.
- Telephony eval targets = voicera + dograh (second project).
- Voice-only focus; static script beats + dynamic enrichment.
- Eval harness as a first-class (thin) component gating agent improvements.

**Open:**
- User-audio injection path: direct WS (deterministic) vs fake-device loopback
  (real browser aesthetic). Leaning direct WS.
- Silent-beat policy: narrate-failure-and-continue (rec, guarantees multi-beat
  demo completes) vs hard-fail the run.
- First-milestone scope: Dograh-only, voice tester, 3 beats, before a dedicated
  eval-suite CLI.

## 11. Environment reference

- Demo user: `uft-demo-1786594772@example.com` / `DemoPass123!`, org `8baa18`.
  Token cached at `data/projects/voicera/discovery/storage-state/session.json`
  (refresh via `POST http://localhost:3200/api/login` when stale).
- MongoDB `mongodb://admin:admin123@localhost:27017/voicera?authSource=admin`,
  connect via `voicera_backend/.venv/bin/python` (pymongo only there).
- Voicera stack: frontend `:3200`, backend FastAPI `:8000`, Mongo `:27017`,
  voice server `:7860` (DOWN). `TestCallSheet` POSTs `/api/outbound-call` ->
  proxies to voice server. Phone input auto-prefixes `+91` on focus (fill
  `9876543210`, digits only). Transcript format `[00:00] agent:/user:` lines.
- TTS: `TTS_BACKEND=gemini|n|say`; kokoro `n` CLI (uv tool install n), mac `say`
  multi-lang voices.
- Dograh: `dograh-hq/dograh`, UI `:3010`, Python/pipecat backend,
  `docker-compose-local.yaml`, native Test Audio/Test Chat, own `evals/` dir
  (STT provider benchmarks), telephony Twilio/Vonage/Vobiz/Cloudonix. Not yet
  cloned.
- Build/tests: `npm run build` + `npm test` (12 pass).

## 12. The five forks (preservation record)

This repo went through five named iterations; all are preserved so any can be
picked up:

1. **ux-flow-tester** - original static-AST + Playwright live crawler + reporter.
2. **product tester** - discovery graph, prioritization, execution, reporting
   (the Prodlens rename; specs under `spec/`).
3. **UI demo agent** - walkthrough adapter driving the real browser with a
   cursor; OS-cursor recording; screenshots -> screenplay.
4. **full product demo/tutorial agent** - scripted demo engine (`demo.ts`),
   narrated MP4 assembly (`explain.ts`), mockRoutes, web app + SSE progress.
5. **voicera / voice AI demo agent - e2e** - the current working tree: seeded
   voicera demo data, stage-1/stage-2 demo scripts + videos, and the eval
   framework design in this doc.
