# Prodlens Specification

**This file is the root of the Prodlens specification.** The spec is one
document split across several files; nothing in `spec/` is standalone. Start
here, follow the map, and use the precedence rules below when two files
disagree.

**Status:** Active - **Spec revision:** 4 - **Last updated:** 2026-08-25

---

## 1. Document map

```
spec/README.md              <- you are here: index, precedence, ID scheme
├── Prodlens-v2-Spec.md     OPERATIVE. Product + technical spec for the
│                           current system (studio, respec, HITL gates,
│                           diagrams, SaaS). Supersedes v1 where they conflict.
├── Prodlens-Product-Spec.md    v1 product spec. Historical baseline: the
│                               verification product. Still normative for
│                               discovery/verification requirements.
├── Prodlens-Technical-Spec.md  v1 technical spec. Historical baseline:
│                               architecture and pipeline stages for
│                               verification. Still normative for Stages 1-7.
├── schemas.md              NORMATIVE data models for both v1 and v2. The one
│                           place type contracts are defined.
└── traceability.md         Bidirectional trace matrix: requirement <-> spec
                            section <-> implementing module <-> status.
```

| file | scope | status | supersedes / superseded by |
| --- | --- | --- | --- |
| [Prodlens-v2-Spec.md](Prodlens-v2-Spec.md) | demo studio, respec, HITL gates, diagram engine, web app, SaaS | Operative (rev 4) | supersedes v1 in the areas listed in §2.2 |
| [Prodlens-Product-Spec.md](Prodlens-Product-Spec.md) | v1 product: spec recovery + navigational verification | Active baseline (v1.1) | partially superseded by v2 |
| [Prodlens-Technical-Spec.md](Prodlens-Technical-Spec.md) | v1 technical: architecture, pipeline, interfaces | Active baseline (v1.1) | §3 moved to `schemas.md`; §10 superseded by v2 §5.4 |
| [schemas.md](schemas.md) | all normative type contracts | Active | consolidates Technical-Spec §3 and `docs/data-models.md` |
| [traceability.md](traceability.md) | requirement/code trace matrix | Active | - |

Related but **not** part of the spec (descriptive, not normative):
`docs/` explains how the system works today, `README.md` is the operator
guide, `docs/adapters.md` is the adapter authoring guide referenced by v2 §1.1.
Where `docs/` and `spec/` disagree, `spec/` wins and `docs/` is the bug.

## 2. Precedence

### 2.1 The rule

1. **`spec/README.md`** (this file) - precedence, IDs, process.
2. **`Prodlens-v2-Spec.md`** - operative behavior. Wins over v1 anywhere they
   overlap.
3. **`schemas.md`** - wins over prose type sketches anywhere in the spec.
4. **v1 Product / Technical specs** - normative only where v2 is silent.
5. **`docs/`, `README.md`** - descriptive. Never normative.

### 2.2 What v2 supersedes explicitly

| v1 location | superseded by | nature of the change |
| --- | --- | --- |
| Product-Spec §3 (v1 scope) | v2 §2, §4, §5 | v1 scoped verification only; demo production and architecture explainers are now first-class |
| Product-Spec §5.4 (presentation) | v2 §7 | web app replaces the sketched viewer set |
| Technical-Spec §3 (core data models) | `schemas.md` | moved verbatim + reconciled with code + extended with v2 studio types |
| Technical-Spec §10 (tech stack) | v2 §5.4 | Cytoscape/React Flow/mermaid-only replaced by elkjs + Remotion + prodlens-owned SVG renderer |
| Technical-Spec §13 (implementation order) | v2 §14 | v1 order completed; v2 sequencing is current |
| v2 §12.3 (pricing table) | v2 §13.10 | per-artifact quotas replaced by credit-based quotas |

Anything not in this table: v1 still stands.

## 3. Requirement ID scheme

Every normative statement is addressable. Cite IDs in code comments, commits,
and gate discussions - never bare section numbers, which move.

| prefix | meaning | defined in | example |
| --- | --- | --- | --- |
| `FR-<area>-<n>` | v1 functional requirement | Product-Spec §5 | `FR-VE-3` (verification engine, detect dead ends) |
| `NFR-<n>` | v1 non-functional requirement | Product-Spec §6 | `NFR-4` (parallel path execution) |
| `PM<n>` | product-manager use case | v2 §2.1 | `PM5` (live-capability demo) |
| `QA<n>` | QA-engineer use case | v2 §2.2 | `QA6` (bug reel) |
| `ENG<n>` | engineer/DevRel use case | v2 §2.3 | `ENG2` (life-of-a-request explainer) |
| `AUD-<id>` | audience persona | v2 §2.4 | `AUD-operator` |
| `G<n>` | HITL gate | v2 §6 | `G5` (scene plan) |
| `P<n>` | web app build phase | v2 §7 | `P4` (demo studio) |
| `V<n>` | acceptance video | v2 §9 | `V3` (architecture summary) |

Area codes for `FR`: `RE` reverse engineering, `IS` input scenarios,
`VE` verification engine, `UI` presentation, `HITL` review gates,
`GE` graph engineering, `GEPA` optimization foundations.

## 4. Traceability rules

Bidirectional traceability is a maintenance contract, not a one-time audit:

- **spec -> code**: every requirement ID appears in
  [traceability.md](traceability.md) with its implementing module and status
  (`implemented` / `partial` / `spec-only` / `not-started`).
- **code -> spec**: every module that implements a requirement carries an
  anchor on its first line (after any shebang), in the form
  `// Spec: <ids> - see spec/traceability.md`, and appears in the
  "Code -> spec index" section of [traceability.md](traceability.md). List
  them with `grep -rn "^// Spec:" src`.
- **Spec ahead of code is legal, silence is not.** When a spec section is
  written before implementation, its trace row says `spec-only` and names the
  gap. `traceability.md` §6 lists every current divergence, and §7 triages every
  `partial` into relax-the-requirement or close-the-gap.
- Changing a requirement means updating its trace row in the same commit.

Run `npm run spec:check` to verify all of this mechanically. It fails when an
internal link breaks, the matrix names a module that doesn't exist, an indexed
module has lost its anchor, an anchored module is missing from the index, or a
module cites a requirement id the Product Spec never defines.

## 5. Reading paths

| you are | read |
| --- | --- |
| new to Prodlens | v2 §1-2, then Product-Spec §1-2 for origin |
| building the demo studio | v2 §4-5, `schemas.md` §3 |
| building verification / QA | Product-Spec §5, Technical-Spec §4-6, `schemas.md` §2 |
| implementing a gate | v2 §6, then the gate's own section |
| adding a product (tenant) | v2 §1.1, `docs/adapters.md`, v2 §4.3 |
| working on pricing/hosting | v2 §12, §13.10 (note §12.3 is superseded) |
| checking what is actually built | [traceability.md](traceability.md) |

## 6. Mirrors and canonical source

This spec exists in two repositories that hold the same product code:

| repo | remote | role |
| --- | --- | --- |
| `ux-flow-tester` | `github.com/knaig/ux-flow-tester` | **canonical for the spec** - edit here |
| `prodlens` | `github.com/knaig/prodlens` | mirror - receives the spec verbatim |

They are separate repositories, not two checkouts of one, so nothing enforces
agreement between them. The rule: **edit the spec in `ux-flow-tester`, then
copy `spec/` across verbatim.** Editing the mirror directly is how the two
drifted before (the §4.3 rewrite of 2026-08-25 had to be applied by hand in
both places).

Verify they agree:

```sh
diff -r <ux-flow-tester>/spec <prodlens>/spec
```

If the repositories are ever merged or one is retired, delete this section
rather than leaving it describing a split that no longer exists.

## 7. Verifying a change before it costs anything

Rendering is the expensive step: a narrated scene costs minutes of wall time,
real TTS spend, and - for browser scenes - a live recording that runs at 1x.
So **no change to the render path is verified by rendering a video.** Climb the
ladder instead, cheapest rung first, and stop at the first one that fails.

| # | rung | command | cost | what it proves |
| --- | --- | --- | --- | --- |
| 0 | types + tests | `npx tsc --noEmit && npm test` | seconds | nothing is structurally broken |
| 1 | spec agreement | `npm run spec:check` | instant | the spec and the code still describe each other |
| 2 | preflight | `npm run render:check` | seconds, offline | environment, inputs, projection, narration state, and an estimate of length/time/spend |
| 3 | still | `npm run diagram:still` | ~2s, no TTS | the layout - clipping, overlap, truncation, orphan nodes |
| 4 | smoke | `npm run diagram:smoke` | ~2s | motion and audio wiring, over a 3-second frame slice |
| 5 | full render | `npm run diagram:render` | minutes + spend | the deliverable |

Rungs 2-4 exist because the failures they catch are the ones that used to be
found only after paying for a full render: a stale narration manifest, a
respec that projects to orphan nodes, a renderer that reports success and
writes nothing.

**Every improvement to the render path carries this checklist:**

1. State what should visibly change, and on which rung it would show up.
2. Run rung 0 and 1 - they gate everything else.
3. Run `render:check`; it must reach `READY to render`. Read the warnings:
   a stale manifest means the next render pays for TTS.
4. For anything visual, look at the still (rung 3) before rendering. A layout
   regression is obvious in a PNG and expensive in a video.
5. For anything about timing, audio, or animation, run the smoke slice (rung 4).
6. Only then render, and only once.
7. Record what changed in `traceability.md` - the status row, or §6 if it
   closes a divergence.

## 8. Change process

1. Edit the file that owns the requirement (see §1).
2. Update its row in `traceability.md`.
3. Bump the **Spec revision** in this file and the `Last updated` date of any
   file touched. Revision is global: one number for the whole spec.
4. If the change supersedes a v1 statement, add a row to §2.2.
5. Copy `spec/` to the mirror repo (§6).
