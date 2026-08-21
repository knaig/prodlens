# Data models

Core types live in `src/types.ts`. Two deliberate extensions to the spec are
noted inline there (`source: "both"` and the GraphVersion wrapper).

## Graph

The unversioned recovery output.

```ts
interface Graph {
  nodes: Record<string, Node>;
  edges: Edge[];
  entryPoints: string[];
}
```

## Node

```ts
interface Node {
  id: string;              // route pattern (static) or live URL (crawl)
  url: string;
  title?: string;
  stateSignature: string;  // hash of important DOM+data, for SPA dedup
  screenshotPath?: string;
  isTerminal?: boolean;
  source: "observed" | "inferred" | "code" | "both";
  sourceFile?: string;     // where the route is defined, when source includes "code"
  metadata?: Record<string, any>;  // metadata.forms -> FormDescriptor[]
}
```

## Edge

```ts
interface Edge {
  id: string;
  from: string;
  to: string | null;       // null = broken / no navigation observed
  action: string;          // human readable: "Click 'Checkout'"
  selector?: string;       // resolvable Playwright locator
  inputScenarioId?: string;// grounded form-fill scenario
  isReturnPath: boolean;
  status: "working" | "broken" | "untested" | "unreachable" | "missing";
  error?: string;
  screenshotPath?: string;
  source: Source;
  sourceFile?: string;
  sourceLine?: number;
  staticClassification?: "navigates" | "server-action" | "local-state" | "dead";
  evidence?: Evidence[];
}
```

## Form detection

`FormDescriptor` / `FormField` (live crawl only - needs a real DOM). Form-scan
also detects `<form>`-less "input clusters" by pairing text fields with a nearby
submit-like button by viewport position.

## GraphVersion

The versioned wrapper every downstream stage operates on. `report` diffs an
intended vs actual version.

```ts
interface GraphVersion {
  id: string;
  type: "intended" | "actual";
  createdAt: string;
  parentVersionId?: string;
  entryPoints: string[];
  nodes: Record<string, Node>;
  edges: Edge[];
}
```

## Personas & journeys

```ts
interface Persona {
  id: string;
  name: string;
  description: string;
  goals: string[];
  traits?: string[];
  source: "inferred" | "provided" | "refined";
}

interface PathStep {
  edgeId?: string;       // grounded in a real edge - never free text
  action: string;
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
  reason: string;
  status: "planned" | "approved" | "running" | "skipped" | "passed" | "failed";
}

interface InputScenario {
  id: string;
  description: string;
  values: Record<string, string | number | boolean>;  // selector -> value
  rationale: string;
  priority: "critical" | "high" | "medium" | "low";
}
```

## Analysis output

`analyzeGraph` produces: unreachable screens, dead-end screens, missing return
paths, broken edges, dead static elements, and local-state-only elements (flagged
for manual triage).

## GEPA

```ts
interface TraceFeedback {
  module: string;
  score: number;          // 0..1
  feedback: string;
  traceSummary: string;
  examples?: { type?: string; detail?: string }[];
}

interface GepaGuidance {
  version: number;
  guidance: string;
  createdAt: string;
  basedOnTraceCount: number;
}
```

## Visual QA

```ts
interface VisualReport {
  generatedAt: string;
  model: string;
  total: number;
  flagged: number;
  shots: VisualShotResult[];  // per-node finding or error
}
```

Categories: `empty-render | spinner | overflow-layout | blank-shell |
dead-button | ok | other`. A screen the model can't read is an error, never a
false finding.
