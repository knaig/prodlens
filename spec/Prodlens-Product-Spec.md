# Prodlens — Product Specification (v1)

**Version:** 1.1  
**Status:** Draft  
**Last Updated:** 2026-08-09

---

## 1. Product Vision

Prodlens reverse-engineers a web application to recover its missing interaction specification, then verifies that the live product delivers coherent, complete user flows.

It is designed for modern SPAs and AI-generated UIs where formal flow specifications are missing, incomplete, or outdated.

The system treats the **navigation graph as a first-class engineering artifact** (Graph Engineering) and uses reflective optimization (GEPA) to continuously improve its own inference and prioritization modules.

**Long-term vision:** Expand into richer requirement and architecture recovery, continuous monitoring, automated fix suggestions, and self-improving recovery/prioritization via GEPA.  
**v1 focus:** High-quality navigation & interaction recovery + verification, presented in an interactive, human-in-the-loop experience, with foundational support for Graph Engineering and GEPA.

---

## 2. v1 Goal

Given a web application (URL + optional codebase), the system must:

1. Recover a usable **Design / Interaction Specification** and **Intended Navigation Graph**
2. Infer core personas and high-value journeys
3. Intelligently select important input scenarios (avoid combinatorial explosion)
4. Verify the live application against recovered navigation contracts
5. Present progress and results in live, interactive graph/tree views
6. Support optional manual review gates before expensive runs
7. Clearly surface:
   - Broken transitions
   - Missing return paths
   - Dead-end states
   - Major gaps in intended flows
8. Treat the navigation graph as a versioned, inspectable, diffable artifact
9. Provide the foundation for GEPA-based optimization of recovery and prioritization modules

---

## 3. v1 Scope

### In Scope

**A. Reverse Engineering (Focused)**
- Recover screens / major states
- Recover interactive elements and apparent transitions
- Build an Intended Navigation Graph as a first-class artifact
- Infer a small set of core personas and critical journeys
- Light requirement signal (main user goals)

**B. Specification Synthesis**
- Turn the recovered interaction model into explicit test contracts
- Prioritize journeys that matter most
- Select only important input value combinations

**C. Verification**
- Execute prioritized paths on the live application (parallel)
- Detect navigational failures (broken transitions, missing returns, dead ends, unreachable intended states)

**D. Interactive Presentation**
- Live graph / tree visualization of flows
- Clickable path explorer (prototype-like)
- Mindmap / hierarchical views
- Markdown rendering of plans and recovered specs

**E. Human-in-the-Loop**
- Optional manual review gates
- Ability to approve, edit, or reject plans before execution

**F. Graph Engineering Foundations**
- Explicit, versionable navigation graph
- Intended vs Actual graph differencing
- Graph algorithms for coverage, return-path detection, and dead-end finding
- Graph as the primary object of both computation and UI

**G. GEPA Foundations**
- Structured feedback from verification runs
- Design of recovery and synthesis modules as optimizable components
- Support for offline reflective improvement of prompts/modules

### Out of Scope for v1
- Full formal Requirement Specification
- Deep Architecture Specification
- Visual design critique
- Accessibility auditing (beyond basic navigation)
- Performance testing
- Automatic code fixes or PR generation
- Native mobile applications
- Fully automated online GEPA loops in production (foundation only)

---

## 4. Core Workflow

```
1. Ingest
   - Application URL (required)
   - Optional: codebase, existing docs, auth credentials, configuration

2. Recover Interaction Model
   - Crawl + observe live app
   - Optionally analyze code (routes, navigation)
   - Produce: screens/states, transitions, Intended Navigation Graph (versioned)
   - Infer core personas + critical journeys

3. Synthesize Contracts & Scenarios
   - Define must-reach states and required transitions/return paths
   - Prioritize journeys
   - Select important input scenarios only

4. Optional Review Gate
   - Present recovered model + planned journeys in Markdown + graph views
   - User can approve / edit / reject

5. Verify
   - Execute prioritized paths in parallel
   - Record actual outcomes vs contracts
   - Stream progress into live graph
   - Produce rich traces + feedback for potential GEPA use

6. Analyze & Diff
   - Compare Intended vs Actual graphs
   - Detect broken transitions, missing returns, dead ends

7. Report & Explore
   - Interactive graph with status overlays
   - Clickable path explorer for interesting/broken flows
   - Prioritized issue list with evidence
```

---

## 5. Functional Requirements

### 5.1 Reverse Engineering
The system must recover:
- Screens / major UI states (with screenshots and state signatures)
- Interactive elements and observed/inferred transitions
- An Intended Navigation Graph (first-class, versionable)
- A small set of core personas and critical journeys
- Light signals of primary user goals

Sources: live application (DOM, screenshots, routing, network) + optional codebase + optional existing docs.

### 5.2 Input Scenario Control
- Detect points where user input affects navigation or downstream state
- Avoid exhaustive combinatorial explosion
- Select only high-value input variations using:
  - Persona/goal importance
  - Equivalence partitioning & boundaries
  - Observed impact on reachable states
  - LLM judgment for minimal high-signal sets
- Explicitly show which scenarios were chosen and why others were deprioritized

### 5.3 Verification Engine
- Execute prioritized journeys against the live app
- Support deterministic steps and goal-oriented agent fallback
- Record actual transitions, screenshots, and outcomes
- Detect broken/incorrect transitions, missing return paths, dead ends, and unreachable intended states
- Emit structured traces and natural-language feedback suitable for GEPA-style reflection

### 5.4 Interactive Presentation
**Live Graph / Tree View**
- Nodes = screens/states
- Edges = user actions
- Visual status encoding (working / broken / untested / missing return)
- Clickable nodes and edges for details
- Filters by persona, priority, issue type
- Support for viewing Intended vs Actual overlays

**Path Explorer**
- Step-by-step interactive view of important journeys
- Screenshots + action taken + expected vs actual
- Feels like a clickable prototype for interesting/broken paths

**Mindmap / Hierarchical Views**
- Personas → goals → journeys
- Product areas → flows
- Easy navigation between high-level structure and detail

**Markdown Viewer**
- Clean rendering of recovered specs and planned journeys
- Support for links into graph nodes/paths
- Readable structured documents for review gates

### 5.5 Manual Review Gates (Optional)
Users can insert approval steps:
- After reverse engineering (review recovered Interaction Spec + Graph)
- After prioritization (approve/edit planned journeys and input scenarios)
- Before large verification runs

Actions: Approve / Edit / Reject & regenerate with guidance.

### 5.6 Graph Engineering Requirements
- The navigation graph is a first-class artifact: versioned, inspectable, diffable, and the primary object of both reasoning and UI.
- Explicit distinction between Intended Graph and Actual Graph.
- Graph algorithms used for:
  - Return-path detection
  - Dead-end identification
  - Coverage measurement
  - Path prioritization support
- Graph diffs form a core part of the verification report.

### 5.7 GEPA Foundations
- Recovery and Synthesis modules are designed as optimizable components with clear inputs/outputs.
- Verification runs produce rich traces + diagnostic feedback (not only scalar scores).
- The system supports offline GEPA-style reflective optimization of key prompts/modules against a small set of labeled or synthetic apps.
- Metrics and feedback functions are defined so that improvements in recovery quality and prioritization quality can be measured and optimized.

---

## 6. Non-Functional Requirements

- Works on modern SPAs (client-side routing, dynamic content)
- Supports authenticated areas (credentials / test accounts)
- Runnable locally and in CI
- Parallel path execution
- Transparent inference (user can inspect why something was inferred or flagged)
- Graceful handling of incomplete recovered models
- Real-time or near-real-time updates to the graph during execution
- Graph artifacts are durable and queryable across runs

---

## 7. Inputs

| Input                        | Required | Purpose                                      |
|-----------------------------|----------|----------------------------------------------|
| Application URL             | Yes      | Primary source for recovery and verification |
| Codebase                    | Optional | Improves recovery of structure and transitions |
| Existing docs / personas    | Optional | Seeds or corrects recovered model            |
| Auth credentials            | Optional | Access protected areas                       |
| Configuration               | Optional | Depth, parallelism, focus areas, review gates |

---

## 8. Outputs

1. Recovered Design / Interaction Specification
2. Versioned Intended Navigation Graph
3. Actual Navigation Graph (from execution)
4. Graph diff (Intended vs Actual)
5. Inferred personas + prioritized journeys
6. Selected input scenarios (with rationale)
7. Live interactive graph and path explorer
8. Verification Report (issues + evidence)
9. Structured traces/feedback suitable for GEPA
10. Optional: generated Playwright tests for critical paths

---

## 9. Success Criteria (v1)

The product succeeds when it can, with minimal configuration:

- Reconstruct a useful Intended Navigation Graph from a real SPA
- Identify non-obvious flow problems (especially missing return paths and dead ends)
- Keep input scenario combinations limited and justified
- Let users explore flows interactively in graph/tree views
- Support lightweight optional review gates
- Treat the graph as a first-class, diffable artifact
- Produce rich enough traces/feedback to support future GEPA optimization
- Produce reports and interactive views that teams find immediately actionable
- Require significantly less manual effort than writing equivalent end-to-end flow tests

---

## 10. Design Principles

- Prefer high-signal navigation issues over exhaustive coverage
- Recovered models and plans must be inspectable and editable
- Runtime grounding (real browser execution) is mandatory
- Prioritization over brute-force exploration
- Interactive exploration over static reports
- Human-in-the-loop should feel lightweight, not bureaucratic
- Transparent reasoning
- **Graph as first-class artifact** (Graph Engineering)
- **Modules are optimizable via reflection on full traces** (GEPA-ready)

---

## 11. Future Expansion (Post-v1)

- Richer Requirement recovery
- Deeper Architecture analysis
- Continuous / CI monitoring mode
- Auto-generation of Playwright tests and suggested fixes
- Multi-role and feature-flag aware exploration
- Stronger collaborative review features
- Online or periodic GEPA optimization loops on real customer apps
- Advanced graph algorithms and embeddings for large applications

---

## 12. Positioning

Prodlens is a **specification recovery + navigational verification system** built on Graph Engineering principles, with an interactive human-in-the-loop interface and a foundation for reflective self-improvement (GEPA).

It first reconstructs what the product’s flows appear to be (as an explicit graph), lets the user review and refine that understanding, verifies whether the live experience delivers coherent user journeys, and is designed so that its own inference quality can improve over time through reflective optimization.
