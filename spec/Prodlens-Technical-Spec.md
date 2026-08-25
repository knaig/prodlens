# Prodlens — Technical Specification (v1)

**Version:** 1.1  
**Status:** Active baseline — partially superseded  
**Last Updated:** 2026-08-25 (§3 moved to schemas.md; supersession notes added)  
**Spec root:** [README.md](README.md) · **Companion:** [Prodlens-Product-Spec.md](Prodlens-Product-Spec.md) · **Operative spec:** [Prodlens-v2-Spec.md](Prodlens-v2-Spec.md)

> **Read this first.** This is the v1 technical spec. It remains normative for
> the verification architecture and pipeline (§2, §4–§9, §11), all traced to
> code in [traceability.md](traceability.md) §1.
>
> Two parts have moved or been superseded:
> - **§3 (core data models)** now lives in [schemas.md](schemas.md), reconciled
>   with the shipped code. The deltas are documented there in §10.
> - **§10 (technology stack)** is superseded by v2 §5.4 for the rendering and
>   diagram layers.
> - **§13 (implementation order)** is complete; current sequencing is v2 §14.

---

## 1. Overview

This document defines the technical architecture, data models, pipeline stages, and key interfaces for Prodlens v1.

The system reverse-engineers a web application’s interaction model, synthesizes prioritized navigation contracts (with controlled input scenarios), optionally pauses for human review, executes verification in parallel, and presents results in interactive graph/tree views.

It is built on two reinforcing ideas:

- **Graph Engineering**: The navigation graph is a first-class, versioned, diffable artifact that both the system and the user reason over.
- **GEPA readiness**: Recovery and Synthesis modules are designed as optimizable components that emit rich traces and diagnostic feedback, enabling reflective prompt/system optimization.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        UI Layer                             │
│  Graph Viewer · Path Explorer · Mindmap · Markdown Reviewer │
│  (Intended vs Actual overlays, version diffs)               │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                     Orchestrator / API                      │
│   Pipeline control · Review gates · State machine · GEPA hooks│
└──────┬──────────┬──────────┬──────────┬──────────┬──────────┘
       │          │          │          │          │
       ▼          ▼          ▼          ▼          ▼
  Recovery   Synthesis  Execution   Analysis   Graph Store
  Engine     Engine     Engine      Engine     (versioned)
```

### Major Components

| Component            | Responsibility                                                                 |
|----------------------|---------------------------------------------------------------------------------|
| Recovery Engine      | Crawl live app + optional code analysis → Interaction Model + Intended Graph   |
| Synthesis Engine     | Personas, journeys, contracts, input scenario selection                        |
| Execution Engine     | Parallel Playwright (or agent) path runners; emit rich traces                  |
| Analysis Engine      | Intended vs Actual graph diff; detect issues; produce GEPA-ready feedback      |
| Graph Store          | Versioned nodes, edges, paths, evidence, status; diff support                  |
| Presentation Layer   | Interactive graph, path explorer, mindmap, markdown viewer                     |
| Orchestrator         | Pipeline state machine + optional review gates + GEPA optimization hooks       |

---

## 3. Core Data Models

> **Moved to [schemas.md](schemas.md).** The type definitions that were inline
> here in v1.1 are now maintained in one normative place, reconciled with the
> shipped code in `src/types.ts` and extended with the v2 studio, respec,
> adapter, metering, and artifact-registry contracts.
>
> The v1.1 sketch this section carried had drifted from the implementation in
> ten documented ways (`source: "both"`, edge provenance and static
> classification, `PathStep.edgeId` grounding, `PathRunResult`,
> `GraphAnalysis`, and others). Keeping two copies is what let that happen;
> [schemas.md §10](schemas.md#10-deviations-from-technical-spec-3-v11) records
> each deviation and why it exists.

| looking for | see |
| --- | --- |
| `Node`, `Edge`, `Graph`, `GraphVersion`, `GraphDiff`, `GraphAnalysis` | [schemas.md §2](schemas.md) |
| `Persona`, `InputScenario`, `PathStep`, `PrioritizedPath`, `PathRunResult` | [schemas.md §2.5](schemas.md) |
| `Issue`, `VerificationReport`, `InteractionModel` | [schemas.md §2.6](schemas.md) |
| `TraceFeedback`, `GepaGuidance` | [schemas.md §3](schemas.md) |
| studio types (`Scene2`, `DemoSpec2`, `NarrationDoc`, `SceneChoreography`) | [schemas.md §5](schemas.md) |
| `Respec` and friends | [schemas.md §6](schemas.md) |

The original v1.1 text remains in git history (`git log -- spec/Prodlens-Technical-Spec.md`).

---

## 4. Pipeline Stages

### Stage 1 — Ingest
- Accept URL (required), optional codebase path, docs, credentials, config.
- Normalize configuration (max depth, parallel workers, review gates on/off, focus areas).

### Stage 2 — Recovery
**Live recovery**
- Playwright-based crawler (BFS or guided).
- For each state: capture URL, title, screenshot, state signature, interactive elements.
- Record observed transitions.
- Handle basic auth and simple session setup.

**Code recovery (optional)**
- Parse routes (Next.js, React Router, etc.).
- Extract navigation calls and major page components.
- Merge with live observations.

**Output:** Versioned `Intended Graph` + initial `InteractionModel`

### Stage 3 — Synthesis
- Infer or refine 3–7 core personas.
- Generate prioritized journeys per persona.
- Detect input-sensitive points and select a minimal high-value set of `InputScenario`s.
- Produce explicit navigation contracts.
- Attach rationale to every prioritized path and input scenario.

**Output:** Personas, `PrioritizedPath[]`, `InputScenario[]`, contracts

### Stage 4 — Optional Review Gate
- Persist current plan as Markdown + graph snapshot.
- Expose UI for user to inspect, edit, approve, or reject.
- On reject: accept free-text guidance and re-run synthesis (or parts of it).
- State machine: `draft → under_review → approved → executing`

### Stage 5 — Execution
- Parallel workers (configurable).
- Each worker executes one `PrioritizedPath` sequentially.
- On every step: perform action, capture state + screenshot, record actual edge, update graph store live.
- Emit structured traces suitable for later reflection.

### Stage 6 — Analysis (Graph Engineering core)
- Build or update the **Actual Graph**.
- Compute **GraphDiff** (Intended vs Actual).
- Detect:
  - Broken transitions
  - Missing return paths (graph algorithm)
  - Dead-end nodes
  - Unreachable intended nodes
- Generate `Issue[]` with severity and evidence.
- Produce `TraceFeedback` objects for GEPA.

### Stage 7 — Presentation
- Stream updates to the interactive graph during execution.
- Final views:
  - Full navigation graph with status and Intended/Actual overlays
  - Graph diff visualization
  - Filterable issue list
  - Path explorer
  - Mindmap of personas → goals → journeys
  - Markdown report export

---

## 5. Graph Engineering Layer

### 5.1 Principles
- The navigation graph is the primary artifact of both computation and user interaction.
- Intended and Actual graphs are first-class and versioned.
- Diffs are explicit and queryable.
- Classical graph algorithms are used for structural properties (returns, dead ends, coverage).

### 5.2 Key Operations
- `createVersion(type, nodes, edges)` → GraphVersion
- `diff(intended, actual)` → GraphDiff
- `findMissingReturnPaths(graph)` → list of nodes/edges
- `findDeadEnds(graph)` → list of nodes
- `computeCoverage(intended, actual)` → metrics
- `highlightPath(graph, pathId)` for UI

### 5.3 UI Implications
- Graph Viewer must support version selection and overlay (Intended vs Actual).
- Diffs should be visually scannable (added/removed/changed edges and nodes).
- Users can click from an issue directly into the relevant graph region.

---

## 6. GEPA Integration (Foundations)

### 6.1 Design Goals
- Recovery and Synthesis are written as clear modules with typed inputs/outputs.
- Every verification run can emit `TraceFeedback` containing:
  - Scalar score (for ranking)
  - Natural-language diagnosis of what went wrong or right
  - Compact trace summary
- Offline GEPA loops can optimize the prompts/instructions of these modules against a small training set of apps or synthetic cases.

### 6.2 Example Feedback Targets
- Recovery quality: “Did the recovered graph capture the known critical screens and transitions?”
- Prioritization quality: “Did the selected journeys include the known broken flows while staying within budget?”
- Diagnosis quality: “Are missing return paths and dead ends correctly identified and explained?”

### 6.3 Future Online Use
Post-v1, the same feedback channel can support periodic or continuous reflective improvement on real customer workloads (with appropriate privacy and control).

---

## 7. Presentation Layer Requirements

### 7.1 Graph Viewer
- Technology suggestion: Cytoscape.js, React Flow, or equivalent.
- Features:
  - Zoom, pan, search
  - Click node/edge → details + evidence
  - Color / stroke encoding for status and priority
  - Intended vs Actual overlay or side-by-side
  - Version switching and diff highlighting
  - Live updates while execution is running
  - Filter by persona, priority, status, issue type

### 7.2 Path Explorer
- Sequential, prototype-like view.
- Screenshot + action + expected vs actual per step.
- Jump links into the graph.

### 7.3 Mindmap / Hierarchical View
- Personas → goals → journeys → key screens.

### 7.4 Markdown Viewer
- Render recovered specs, planned journeys, and reports.
- Internal links to graph nodes/paths.
- Clean typography for review sessions.

---

## 8. Input Scenario Control (Technical)

1. Identify forms/controls that influence navigation or major state.
2. Propose candidate partitions (empty, valid typical, invalid, boundary, persona-relevant).
3. Score combinations by impact, persona relevance, and likelihood of exposing issues.
4. Keep only a budgeted set per journey.
5. Store and surface rationale.
6. Feed selection quality into GEPA feedback when optimizing the synthesis module.

---

## 9. Review Gate State Machine

```
draft
  → under_review
      → approved
      → rejected          (feedback → synthesis or draft)
approved
  → executing
      → completed
      → failed
```

---

## 10. Suggested Technology Stack (v1)

> **Partially superseded by v2 §5.4.** The rendering and diagram rows below
> are historical. Current: **elkjs** for layout, **Remotion** as the render
> shell (one React tree is both the scrubbable artifact and the exported MP4),
> and a prodlens-owned SVG renderer for sequence and tutorial-tier diagrams —
> mermaid's generated SVG is hostile to element addressing and animation, so
> it survives only for summary-tier stills. The web app is plain Node `http` +
> SSE (v2 §7), not Next.js. Runtime, Playwright, LLM abstraction, and graph
> storage rows are unchanged and accurate.

| Layer              | Suggestion                                      |
|--------------------|-------------------------------------------------|
| Runtime            | Node.js + TypeScript                            |
| Browser automation | Playwright                                      |
| Optional agents    | Playwright Test Agents / browser-use / Midscene |
| LLM                | Claude / OpenAI / local (via abstraction)       |
| Optimization       | DSPy + GEPA (for offline module improvement)    |
| Graph storage      | SQLite or JSON + in-memory; versioned artifacts |
| Graph visualization| Cytoscape.js or React Flow                      |
| UI                 | React / Next.js                                 |
| Markdown           | MDX or standard markdown renderer               |
| API                | Simple REST or tRPC                             |
| Parallelism        | Playwright workers or job queue                 |

---

## 11. Key Interfaces (Sketch)

```ts
interface RecoveryEngine {
  recover(options: RecoveryOptions): Promise<InteractionModel>;
}

interface SynthesisEngine {
  synthesize(model: InteractionModel, options: SynthesisOptions): Promise<{
    personas: Persona[];
    paths: PrioritizedPath[];
    scenarios: InputScenario[];
    contracts: Contract[];
  }>;
}

interface ExecutionEngine {
  execute(paths: PrioritizedPath[], options: ExecutionOptions): AsyncIterable<ExecutionEvent>;
}

interface AnalysisEngine {
  analyze(intended: GraphVersion, actual: GraphVersion, results: ExecutionResult[]): {
    report: VerificationReport;
    feedback: TraceFeedback[];
  };
}

interface GraphStore {
  saveVersion(graph: GraphVersion): string;
  getVersion(id: string): GraphVersion;
  diff(a: string, b: string): GraphDiff;
  // live query helpers for the UI
}
```

---

## 12. Configuration (Example)

```yaml
url: https://staging.example.com
codebase: ./apps/web
auth:
  strategy: storage_state
  storageStatePath: ./auth.json
limits:
  maxNodes: 150
  maxDepth: 6
  parallelWorkers: 6
  maxInputScenariosPerPath: 4
reviewGates:
  afterRecovery: true
  afterSynthesis: true
graph:
  versioning: true
  retainVersions: 20
gepa:
  enabled: false          # offline optimization only in v1
  feedbackCapture: true
llm:
  provider: anthropic
  model: claude-sonnet-5
```

---

## 13. Implementation Order (Recommended)

> **Complete; superseded by v2 §14.** Items 1–11 shipped (see
> [traceability.md](traceability.md) §1); item 12, the offline GEPA
> experimentation harness, is the one open item — tracked as `FR-GEPA-4`
> (`partial`: feedback targets exist, a labeled training set and scoring
> harness do not).

1. Project setup + core data models + versioned Graph Store
2. Basic Playwright crawler (Recovery Engine – live only)
3. Simple Synthesis (personas + paths) with LLM
4. Single-path executor + parallel wrapper
5. Analysis with GraphDiff + missing-return / dead-end detection
6. Graph visualization (static → live updates + Intended/Actual)
7. Path Explorer + Markdown report
8. Input scenario selection logic
9. Review gate state machine + UI
10. TraceFeedback emission (GEPA foundation)
11. Code-assisted recovery
12. Offline GEPA experimentation harness
13. Polish, CI mode, export

---

## 14. Open Technical Risks & Mitigations

| Risk                              | Mitigation                                              |
|-----------------------------------|---------------------------------------------------------|
| Low-quality recovered model       | Inspectable/editable graph; user correction; GEPA later |
| Combinatorial input explosion     | Strict budgeting + rationale + GEPA on selection logic  |
| Flaky live execution              | Retries, stable state signatures, clear evidence        |
| Auth & stateful areas             | Explicit auth setup + storage state support             |
| LLM non-determinism in planning   | Structured outputs, review gates, later GEPA            |
| Graph UI performance              | Clustering / pagination for large graphs                |
| Version explosion                 | Retention policy + prune old versions                   |

---

## 15. Success Metrics (Technical)

- Can recover a usable navigation graph from a real SPA with reasonable compute
- Input scenarios per critical path stay within budget
- Review gates remain lightweight
- Interactive graph remains responsive for typical app sizes
- Clear evidence attached to every reported issue
- GraphDiff correctly surfaces missing returns and dead ends
- TraceFeedback is sufficiently diagnostic for offline GEPA experiments

---

This technical specification is implementation-ready and explicitly incorporates Graph Engineering and GEPA foundations.
