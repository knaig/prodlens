# Prodlens Schemas (normative data models)

Part of the [Prodlens specification](README.md). **Precedence: this file is the
single normative definition of every Prodlens type contract.** Where a prose
type sketch elsewhere in the spec disagrees with this file, this file wins
(spec README §2.1).

**Spec revision:** 4 - **Last updated:** 2026-08-25

**Relation to code.** Types here are mirrored by executable definitions:

| section | executable form |
| --- | --- |
| §2 Verification core, §3 GEPA | `src/types.ts` |
| §4 Visual QA | `src/visual/triage.ts` |
| §5 Studio (script/scenes/choreography) | `src/studio/types.ts` |
| §6 Reverse-spec | `src/respec/respec.ts` |
| §7 Adapters | `src/adapters/types.ts` |
| §8 Metering | `src/usage/ledger.ts` |
| §9 Artifact registry | `src/studio/store.ts` |

The code is the reference implementation; this file is the contract. Divergence
is a defect in one of the two, and every known instance is listed in
[traceability.md](traceability.md) §6.

**History.** §2-3 were moved here from Technical-Spec §3 (v1.1) and reconciled
with the shipped code; the deltas are documented in §10. `docs/data-models.md`
is now a descriptive summary that points here.

---

## 1. Conventions

- All timestamps are ISO-8601 strings.
- All ids are opaque strings; only monotonic `version` fields carry ordering.
- `?` marks optional. Absent and `null` are distinct: `Edge.to = null` means
  "observed, and it went nowhere"; absent means "not yet observed".
- Type unions are closed. Adding a member is a spec change (README §6).

## 2. Verification core

Implemented in `src/types.ts`. Produced by the static pass, live crawler,
synthesis, executor, analysis, and reporter.

### 2.1 Provenance and evidence

```ts
type Source = "observed" | "inferred" | "code" | "both";

interface Evidence {
  type: "screenshot" | "dom" | "network" | "console" | "log";
  pathOrValue: string;
  timestamp: string;
}
```

`"both"` means confirmed by the static pass *and* the live crawl - strictly
more certain than either alone (§10, deviation D1).

### 2.2 Screens and transitions

```ts
interface Node {
  id: string;                 // route pattern (static) or live URL (crawl)
  url: string;
  title?: string;
  stateSignature: string;     // hash of meaningful DOM + key data, for SPA dedup
  screenshotPath?: string;
  isTerminal?: boolean;
  source: Source;
  sourceFile?: string;        // set when source includes "code"
  metadata?: Record<string, any>;   // metadata.forms -> FormDescriptor[]
}

type StaticClassification =
  | "navigates"        // <Link>, router.push, redirect - known target
  | "server-action"    // onClick calls an imported "use server" function
  | "local-state"      // onClick only touches local state, no server call
  | "dead";            // no onClick, no href, no form action

interface Edge {
  id: string;
  from: string;               // Node.id
  to: string | null;          // null = broken / no navigation observed
  action: string;             // human-readable: "Click 'Checkout'"
  selector?: string;          // resolvable Playwright locator
  inputScenarioId?: string;
  isReturnPath: boolean;
  status: "working" | "broken" | "untested" | "unreachable" | "missing";
  error?: string;
  screenshotPath?: string;
  source: Source;
  sourceFile?: string;
  sourceLine?: number;
  staticClassification?: StaticClassification;
  evidence?: Evidence[];
}
```

### 2.3 Forms

Live crawl only - detecting input types, names, and required-ness needs a real
rendered DOM. Form scanning also detects `<form>`-less "input clusters" by
pairing text fields with a nearby submit-like button by viewport position.

```ts
interface FormField {
  name: string;
  type: string;               // input type attribute, or "textarea" / "select"
  selector: string;           // e.g. [name="email"]
  placeholder?: string;
  required?: boolean;
}

interface FormDescriptor {
  selector: string;
  fields: FormField[];
  submitSelector?: string;
  submitLabel?: string;
}
```

### 2.4 Graph artifacts

```ts
interface Graph {
  nodes: Record<string, Node>;
  edges: Edge[];
  entryPoints: string[];
}

interface GraphVersion extends Graph {
  id: string;
  type: "intended" | "actual" | "merged";
  createdAt: string;
  parentVersionId?: string;
  metadata?: Record<string, any>;
}

interface GraphDiff {
  fromVersionId: string;
  toVersionId: string;
  addedNodes: string[];
  removedNodes: string[];
  addedEdges: string[];
  removedEdges: string[];
  changedEdges: string[];        // status or target changed
  missingReturnPaths: string[];  // "from->to"
  deadEnds: string[];            // node ids
}

interface GraphAnalysis {
  unreachableNodes: string[];    // never reached from any entry point
  deadEndNodes: string[];        // reachable, zero working outgoing edges
  missingReturnPaths: { from: string; to: string }[];
  brokenEdges: Edge[];
  deadStaticElements: Edge[];         // staticClassification === "dead"
  localStateOnlyElements: Edge[];     // flagged for human triage
}
```

`GraphAnalysis` is the raw structural pass, independent of any diff - it is
what the `scan` and `discover` reports render directly, and it is folded into
`Issue[]` for the full pipeline report.

### 2.5 Personas, scenarios, journeys

```ts
interface Persona {
  id: string;
  name: string;
  description: string;
  goals: string[];
  traits?: string[];
  source: "inferred" | "provided" | "refined";
}

interface InputScenario {
  id: string;
  description: string;
  values: Record<string, string | number | boolean>;  // selector -> value
  rationale: string;                                  // required: FR-IS-4
  priority: "critical" | "high" | "medium" | "low";
}

interface PathStep {
  edgeId?: string;            // grounding: a real edge, never free text
  action: string;             // display + agent-fallback form
  expectedNodeId?: string;
  actualNodeId?: string;
  status?: "pending" | "passed" | "failed";
  error?: string;
  evidence?: Evidence[];
}

interface PrioritizedPath {
  id: string;
  personaId: string;
  goal: string;
  steps: PathStep[];
  inputScenarioIds?: string[];
  priority: "critical" | "high" | "medium" | "low";
  reason: string;             // required: every path justifies itself
  status: "planned" | "approved" | "running" | "passed" | "failed" | "skipped";
}

interface PathRunResult {
  pathId: string;
  personaId: string;
  goal: string;
  status: "passed" | "failed" | "partial";
  stepsCompleted: number;
  stepsTotal: number;
  edgesObserved: Edge[];
  error?: string;
  screenshotPaths: string[];
  startedAt: string;
  finishedAt: string;
}
```

**Grounding rule (normative).** `PathStep.edgeId` referencing a real edge is
how execution stays deterministic. The same rule governs the script compiler
(v2 §4.2 step 2) and journey planning. `status: "skipped"` is also the
rejected-at-gate state; there is no separate `"rejected"`.

### 2.6 Findings and reports

```ts
interface Issue {
  id: string;
  type: "broken_transition" | "missing_return" | "dead_end"
      | "unreachable" | "spec_deviation" | "visual";
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  nodeIds?: string[];
  edgeIds?: string[];
  pathId?: string;
  evidence?: Evidence[];
}

interface VerificationReport {
  summary: {
    nodesCovered: number;
    edgesCovered: number;
    brokenTransitions: number;
    missingReturnPaths: number;
    deadEnds: number;
  };
  issues: Issue[];
  graphDiff?: GraphDiff;
  generatedAt: string;
}

interface InteractionModel {
  intendedGraph: GraphVersion;
  actualGraph?: GraphVersion;
  diff?: GraphDiff;
  recoveredAt: string;
  sources: ("live" | "code" | "docs")[];
}
```

## 3. GEPA feedback

```ts
interface TraceFeedback {
  runId: string;
  module: "recovery" | "synthesis" | "prioritization" | "diagnosis";
  score: number;              // scalar, for ranking
  feedback: string;           // rich natural-language diagnosis
  traceSummary: string;
  examples?: any[];
}

interface GepaGuidance {
  version: number;
  guidance: string;           // injected into the next synthesize() prompt
  createdAt: string;
  basedOnTraceCount: number;
}
```

Rich feedback, not only a scalar, is the requirement (FR-GEPA-2). QA triage
verdicts (v2 §2.2, QA4) feed this channel.

## 4. Visual QA

Implemented in `src/visual/triage.ts`.

```ts
type VisualSeverity = "ok" | "low" | "medium" | "high" | "critical";
type VisualCategory = "empty-render" | "spinner" | "overflow-layout"
                    | "blank-shell" | "dead-button" | "ok" | "other";

interface VisualFinding { /* category, severity, description */ }
interface VisualShotResult { /* per-node finding or error */ }

interface VisualReport {
  generatedAt: string;
  model: string;
  total: number;
  flagged: number;
  shots: VisualShotResult[];
}
```

**Normative rule:** a screen the model cannot read is recorded as an *error*,
never as a finding. Unreadable is not the same as broken.

## 5. Studio: script -> scenes -> choreography

Implemented in `src/studio/types.ts`. Specified by v2 §4. The three artifacts
below are the spine of the demo product; each has its own HITL gate.

### 5.1 Narration (v2 §4.4)

```ts
interface NarrationLine {
  id: string;                 // stable; choreography and scenes reference this
  sceneId: string;
  text: string;               // default-language text
  variants?: Record<string, string>;   // BCP-47-ish code -> localized text
  voice?: string;             // cast voice override (dialogue mode)
}

interface NarrationDoc {
  language: string;
  register?: string;          // derived from vision.md + audience persona
  lines: NarrationLine[];
  glossary?: Record<string, string>;        // terminology lock
  pronunciations?: Record<string, string>;  // phonetic hints, per project
}

interface VoiceSpec {
  backend?: "gemini" | "kokoro" | "say" | "auto";
  name?: string;
  style?: string;             // e.g. "Indian English accent, warm" (PM2)
}
```

Localization edits variants, never structure (v2 §4.4). Editing a line never
touches scene structure - scenes reference line ids.

### 5.2 Scenes

```ts
type SceneType = "card" | "login" | "screen" | "call" | "diagram" | "artifact";

interface Scene2 {
  id: string;
  type: SceneType;
  act?: string;               // story-frame act (v2 §4.6)
  narrationIds?: string[];    // into NarrationDoc.lines
  beat?: string;              // script beat this scene satisfies (v2 §4.2)

  // screen / login
  goto?: string;
  click?: string;
  fill?: Record<string, string>;
  scroll?: "down" | "tour" | false;
  settleMs?: number;
  optional?: boolean;

  // card
  title?: string;
  tagline?: string;

  // diagram
  tier?: "summary" | "tutorial";
  scenario?: string;
  mode?: "narrator" | "cast";     // "cast" = humanized components (v2 §13.3)

  // session / call - see 5.3. `goto`/`click` above reach the page; the
  // adapter takes over from there.
  sessionKind?: string;
  turns?: SessionTurn[];   // { speaker, text?, bargeIn? }

  // artifact
  artifactRel?: string;
}

interface DemoSpec2 {
  version: 2;
  title: string;
  projectId: string;          // project registry key
  baseUrl: string;
  audience?: string;          // AudiencePersona.id (v2 §2.4)
  frame?: string;             // StoryFrame.id (v2 §4.6)
  language?: string;
  voice?: VoiceSpec;
  viewport?: { width: number; height: number };
  adapter?: string;                    // pin the session adapter (§5.3)
  manifest?: Record<string, unknown>;  // adapter config, opaque to core
  scenes: Scene2[];
}

interface Gap {
  beat: string;
  reason: string;             // why the product cannot satisfy it
  suggestion?: string;
}

interface CompileResult {
  spec: DemoSpec2;
  narration: NarrationDoc;
  gaps: Gap[];
}
```

**Normative:** unsatisfiable beats become `Gap` entries. Silently dropping a
beat is a defect (v2 §4.2 step 3). Gaps are reserved for *human* beats the
product cannot satisfy; a generated beat referencing a capability absent from
the respec is a compiler error (v2 §13.6).

### 5.3 Session / call scenes (v2 §4.3)

Transport-agnostic at this level. A scene carries only `sessionKind` (free
text, e.g. `"voice-call"`) and a `turns` script. It never carries a protocol,
WebSocket URL, or audio format. Execution is always delegated to the project's
resolved adapter via `adapter.execute({ op, args: { turns, ... } }, ctx)`.
Core renderers must not hardcode a product's transport.

`turns[].bargeIn` truncates the prior speaker mid-word - a genuine
interruption, not a scripted pause.

Core resolves the adapter by asking which one declares the op — a `PrimitiveDef`
whose `op` equals `sessionKind`, or a `SceneTypeDef` whose `id` does. Core
never names an op itself. `DemoSpec2.adapter` pins one when several qualify,
and `DemoSpec2.manifest` is passed through untouched for adapter configuration.

The renderer reaches the adapter through `DemoOptions.onSession`
(`src/execution/demo.ts`), which hands over the live recording page. The demo
renderer itself knows nothing about sessions beyond "call this and wait", which
is what keeps transport out of core.

> **Implementation status:** the contract and the bridge are implemented; the
> reference adapter is `src/adapters/session-dom-adapter.ts` (DOM chat). No
> voice adapter exists yet — see [traceability.md](traceability.md) §6,
> `D-CALL-1`.

### 5.4 Choreography (the render contract, v2 §4)

One timeline per scene; all times in seconds from scene start.

```ts
interface SceneChoreography {
  sceneId: string;
  durationSec: number;
  tracks: {
    narration: Array<{ at: number; lineId: string; dur: number; text: string }>;
    cursor:    Array<{ at: number; to: string; x?: number; y?: number }>;
    animation: Array<{ at: number; target: string; effect: string }>;
    camera:    Array<{ at: number; effect: string; target?: string }>;
  };
}
```

Normative properties: **inspectable and editable** at the render gate;
**deterministic** (same choreography + same app state -> same video, which is
what per-scene re-render caching keys on); **renderer-agnostic** (`screen`
scenes leave `animation` empty, `diagram` scenes use all four tracks);
**human edits are pinned** - a recompile fills around them, never clobbers
them. `screenplay.md` / `.json` is a generated projection of this file, and
remains the voice-artist handoff (PM7).

### 5.5 Audiences and story frames

```ts
interface AudiencePersona {
  id: string;
  who: string;
  wants: string;
  maxMinutes: number;
  register: string;
  diagramTier: "summary" | "tutorial" | "none";
  presence: "none" | "chip" | "guide";       // v2 §4.5
}

interface StoryFrame {
  id: string;
  acts: string[];
  defaultAudience: string;
  guidance: string;           // per-frame drafting prompt
}
```

Reference sets ship as the `AUDIENCES` and `FRAMES` constants in
`src/studio/types.ts`; projects override them in `vision.md`. The audience
contract is enforced at the scene-plan gate (G5): a scene violating it is
surfaced as a warning, and `presence: "chip" | "guide"` is rejected outright
for `prospect` / `executive` / architecture specs (v2 §4.5).

## 6. Reverse-spec (v2 §3)

Implemented in `src/respec/respec.ts`. Written to
`data/projects/<app>/respec/spec.json` + `spec.md`.

```ts
interface RespecComponent {
  name: string;
  kind: "client" | "frontend" | "backend" | "data" | "provider" | "worker" | "other";
  role: string;
  port?: string;
  protocol?: string;
  dependsOn?: string[];
  limitations?: string[];                        // feeds "cast" narration
  internals?: Array<{ name: string; role: string }>;   // L2, deep respec (§13.1)
}

interface RespecFlow {
  name: string;
  steps: Array<{ from: string; to: string; action: string }>;
}

interface RespecCapability {
  name: string;
  screens?: string[];
  routes?: string[];
  services?: string[];
  entities?: string[];
}

interface Respec {
  generatedAt: string;
  oneLiner: string;
  goals: string[];
  personas: string[];
  capabilities: RespecCapability[];
  topology: RespecComponent[];
  flows: RespecFlow[];
  drift: Array<{
    claim: string;
    source: string;
    status: "confirmed" | "not-found-in-code" | "undocumented-capability";
  }>;
  annotations: Record<string, string>;   // "<section>:<name>" -> human note
  source: "llm" | "heuristic";
}
```

**Normative:** `annotations` survive regeneration - re-respec merges, never
clobbers human notes (v2 §3). The respec is the grounding authority: diagram
elements and narration product-claims must trace to an entry here, or they are
flagged at review (v2 §5.1, §4.4).

## 7. Adapters

The product-agnostic boundary. Full contract in `src/adapters/types.ts`;
authoring guide in `docs/adapters.md`; the product-agnosticism rule is v2 §1.1.

Key types: `ProductSurface`, `ComponentInfo`, `ResourceNeed`,
`ResourceResolution` (`"satisfied" | "obtainable" | "blocked"`),
`PrimitiveInvocation`, `PrimitiveResult`, `CapturedArtifact`, `SceneSpec`,
`SceneTypeDef`, `PrimitiveDef`, `ProdlensAdapter`, `PrimitiveContext`,
`ProductManifest`, `WalkthroughPlan`.

**Normative:** engine, DSL, pipeline, and web app contain zero
product-specific knowledge. Product specifics live in exactly three places:
the registry entry, the product's adapter, and the product's own artifacts. A
blocked resource skips its scene with a screenplay note - never a crashed
render (v2 §4.3).

## 8. Metering (v2 §12.2)

Implemented in `src/usage/ledger.ts`.

```ts
type CostBucket = "llm" | "vision_llm" | "tts" | "crawl" | "execute"
                | "render" | "storage";

interface CostEvent { /* refId-keyed, appended to events-YYYY-MM.jsonl */ }
interface UsageSummary { /* per-month, per-project, per-bucket rollup */ }
interface Budgets { /* per-project monthly caps */ }
```

**Normative:** unit costs are labeled **estimates**, precise enough for cap
enforcement and not a billing-grade token meter. `recordCost` is idempotent
per `refId` per month. Stages refuse to start past cap (HTTP 402). Pricing
tables must be computed from these same constants so pricing cannot silently
drift from cost (v2 §12.2).

## 9. Artifact registry (v2 §13.8)

Implemented in `src/studio/store.ts`.

```ts
interface ArtifactEntry {
  id: string;
  name: string;               // logical name, e.g. "operator-workflow-video"
  version: number;            // monotonic per name
  title: string;
  description: string;
  kind: "video" | "respec" | "report" | "storyboard";
  rel: string;                // project-relative path
  inputsHash?: string;
  createdAt: string;
  createdBy?: string;
}
```

**Normative:** re-registering an artifact whose `inputsHash` and `kind` already
exist returns a duplicate warning before the render runs.

## 10. Deviations from Technical-Spec §3 (v1.1)

These are deliberate and shipped. Each is why this file, not the v1 sketch, is
normative.

| id | deviation | rationale |
| --- | --- | --- |
| D1 | `Source` gains `"both"` | a node/edge confirmed by static pass *and* live crawl is strictly more certain; collapsing it loses that signal |
| D2 | `Node.sourceFile`, `Edge.sourceFile`, `Edge.sourceLine` | provenance-on-hover (v2 §7 UX principle 6) needs file:line |
| D3 | `Edge.source`, `Edge.staticClassification` | the static pass classifies elements before any click confirms behavior |
| D4 | `GraphVersion extends Graph` | v1 duplicated `nodes`/`edges`/`entryPoints`; extension keeps one definition |
| D5 | `PathStep.edgeId`, `PathStep.error` | the grounding rule (§2.5) - deterministic replay instead of interpreted free text |
| D6 | `PathRunResult` added | v1 had no execution-result type |
| D7 | `GraphAnalysis` added | structural findings independent of any diff, for `scan` / `discover` |
| D8 | `Issue.type` gains `"visual"` | the visual QA pass (§4, QA5) emits into the same issue list |
| D9 | `GepaGuidance` added | v1 defined feedback capture but not the distilled guidance artifact |
| D10 | no `"rejected"` in `PrioritizedPath.status` | `"skipped"` already means rejected-and-excluded-from-run |
