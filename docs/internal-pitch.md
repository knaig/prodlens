# prodlens: internal trial

A tool for teams that ship web apps and want a single, repeatable answer to:
*does the whole product still work, and can we show someone what it does?*

## The problem it addresses

Most teams test "does this one flow work" and hope the rest holds together. AI-assisted
("vibe-coded") UIs accumulate a specific failure mode that normal testing misses:
buttons that render but do nothing, links to routes that no longer exist, screens
designed but never wired into navigation. And when you finally have a working product,
building a demo of it is usually manual, scripted, and stale a week later.

prodlens attacks both halves: it verifies the whole navigation graph, and it
produces narrated demos from the same walkthrough - so the artifact you show people
reflects the product that actually runs today.

## What it does (in plain terms)

- **Maps your app** - two passes build a graph of screens and transitions: a fast
  static scan of your source (no browser, no server) plus a live Playwright crawl
  that reads real rendered links and clicks real elements.
- **Finds what's broken** - unreachable screens, dead ends, missing return paths,
  broken edges, buttons that look wired but do nothing.
- **Plans and executes journeys** - an LLM proposes the critical user journeys
  (with a no-key heuristic fallback), a human approves/rejects, and Playwright
  replays them against the live app in parallel, filling forms and recording what
  actually happens.
- **Reports the diff** - what we planned vs what happened, ranked by severity, with a
  CI-friendly exit code.
- **Makes the demo** - from the same walkthrough, it records a narrated product demo:
  a real cursor that glides and clicks (the actual OS pointer), live page scrolling,
  TTS voiceover (Gemini or local Kokoro), burned-in captions, plus a silent video and
  a timestamped screenplay you can re-record yourself.

## The value prop

**One repeatable pipeline that turns a running web app into two things at once: a
verification report and a shareable demo - and re-runs on every change.**

You get, per app:

1. A living map of the product (screens + transitions) that reveals gaps no one
   was tracking.
2. A verification report after every change - re-run the pipeline, see what broke.
3. A narrated demo video + screenplay, generated automatically, that always matches
   the current product - no manual screen-capture sessions.

Because it drives a real browser and talks to the real app, the demo and the report
describe the same reality. That is the difference between "we think it works" and
"here is proof it works, and here is what it looks like."

## Who it's for

| Stakeholder | What they get |
| --- | --- |
| **Product / PM** | A shareable narrated demo of the product as it actually is; a navigation map to spot UX gaps (dead ends, screens nobody wired in). |
| **Engineering** | A repeatable check after every change; broken edges and dead elements surfaced before a user hits them; one command from CI. |
| **QA / Test** | Auto-generated journeys grounded in real screens, replayable deterministically; vision QA pass that flags blank/spinner/clipped screens. |
| **Founders / GTM** | Demo videos + screenplays on demand for pitch decks, onboarding, docs, and landing pages - without booking a screen-capture session. |
| **Support / Onboarding** | A timestamped screenplay alongside a silent video, so anyone can re-record narration in their own voice. |

## What the trial gives you

- Run it against your own app's repo and dev server. We'll help get it pointed at
  your stack (Next.js today; the live crawl works on any web app).
- It authenticates against your real auth (Clerk, or any form login - it caches the
  session, and can even create a fresh test account on the fly).
- You keep the artifacts: graphs, reports, videos, screenplays - per project, under
  your repo.
- Runs on cheap models (DeepSeek / Qwen / Kimi via a single OpenRouter key), or fully
  offline with zero keys (heuristic fallbacks everywhere).

## Honest caveats (read before trusting it)

- **Auth**: your app's sign-in needs a test account or the `+clerk_test` convention
  for auto-signup. The real-OS-cursor demo requires the browser window to stay
  frontmost while recording (macOS screen capture).
- **Crawler vs real bugs**: some button clicks get flagged "broken" when they just
  open a dialog the crawler can't click through. Treat flagged edges as a lead to
  check, not a verdict.
- **Scope**: the static pass is Next.js App Router today; the live crawl is
  framework-agnostic.
- It needs your dev server running locally (or in CI) - it tests the real app.

## The ask

We're not deciding open source yet. For now: pick one app you own, give us a few
hours, and we'll point prodlens at it, run the pipeline, and hand you a report
and a demo you can judge for yourself. If it earns a place in your workflow, we'll
talk about scaling it to more teams and repos.
