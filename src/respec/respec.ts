// Spec: v2 §3 (ENG3, ENG4) - see spec/traceability.md
// Reverse-engineered spec (spec v2 §3): read repo + docs + discovery graph and
// write what the product actually is - capability inventory, service topology,
// key flows, drift vs docs - as respec/spec.json + spec.md. LLM-drafted when an
// endpoint is configured, heuristic fallback otherwise. Human annotations in
// respec/annotations.json survive regeneration (merged, never clobbered).
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { buildSurface } from "../adapters/surface.js";
import { localChat, isLlmConfigured, llmModel } from "../llm/local.js";
import type { Graph } from "../types.js";

export interface RespecComponent {
  name: string;
  kind: "client" | "frontend" | "backend" | "data" | "provider" | "worker" | "other";
  role: string;
  port?: string;
  protocol?: string;
  dependsOn?: string[];
  /** Known constraints/limitations (from docs + annotations) - feeds the humanized "cast" narration. */
  limitations?: string[];
  /** L2 drill-down: what lives inside this component (deep respec). */
  internals?: Array<{ name: string; role: string }>;
}
export interface RespecFlow {
  name: string;
  steps: Array<{ from: string; to: string; action: string }>;
}
export interface RespecCapability {
  name: string;
  screens?: string[];
  routes?: string[];
  services?: string[];
  entities?: string[];
}
export interface Respec {
  generatedAt: string;
  oneLiner: string;
  goals: string[];
  personas: string[];
  capabilities: RespecCapability[];
  topology: RespecComponent[];
  flows: RespecFlow[];
  drift: Array<{ claim: string; source: string; status: "confirmed" | "not-found-in-code" | "undocumented-capability" }>;
  /** Human notes keyed by "<section>:<name>" - preserved across regenerations. */
  annotations: Record<string, string>;
  source: "llm" | "heuristic";
}

export interface RespecInputs {
  name: string;
  repoRoot?: string;
  docDirs?: string[];
  /** discovery dir holding graph.json */
  dataDir?: string;
  visionText?: string;
}

/** SUMMARY-aware doc content ingestion: SUMMARY.md order first, then README +
 *  top-level docs, size-capped. Fixes the paths-only gap in surface.ts. */
export function readDocContents(repoRoot: string | undefined, docDirs: string[] | undefined, maxFiles = 14, maxBytes = 30_000): Array<{ path: string; content: string }> {
  const roots: string[] = [];
  if (repoRoot) roots.push(join(repoRoot, "docs"), join(repoRoot, "README.md"));
  for (const d of docDirs ?? []) roots.push(d);
  const files: string[] = [];
  const pushFile = (p: string) => { if (existsSync(p) && statSync(p).isFile() && files.length < maxFiles * 3) files.push(p); };
  for (const r of roots) {
    if (!existsSync(r)) continue;
    if (statSync(r).isFile()) { pushFile(r); continue; }
    const summary = join(r, "SUMMARY.md");
    if (existsSync(summary)) {
      pushFile(summary);
      const links = [...readFileSync(summary, "utf-8").matchAll(/\]\(([^)]+\.md)\)/g)].map((m) => join(r, m[1]));
      for (const l of links) pushFile(l);
    }
    const walk = (dir: string, depth: number) => {
      if (depth > 2) return;
      for (const f of readdirSync(dir)) {
        const full = join(dir, f);
        if (statSync(full).isDirectory()) walk(full, depth + 1);
        else if (f.endsWith(".md")) pushFile(full);
      }
    };
    walk(r, 0);
  }
  const seen = new Set<string>();
  const out: Array<{ path: string; content: string }> = [];
  for (const p of files) {
    if (seen.has(p) || out.length >= maxFiles) continue;
    seen.add(p);
    try {
      out.push({ path: p, content: readFileSync(p, "utf-8").slice(0, maxBytes) });
    } catch { /* unreadable */ }
  }
  return out;
}

const RESPEC_SCHEMA = {
  type: "object",
  properties: {
    oneLiner: { type: "string" },
    goals: { type: "array", items: { type: "string" } },
    personas: { type: "array", items: { type: "string" } },
    capabilities: { type: "array", items: { type: "object", properties: { name: { type: "string" }, screens: { type: "array", items: { type: "string" } }, routes: { type: "array", items: { type: "string" } }, services: { type: "array", items: { type: "string" } }, entities: { type: "array", items: { type: "string" } } }, required: ["name"] } },
    topology: { type: "array", items: { type: "object", properties: { name: { type: "string" }, kind: { type: "string", enum: ["client", "frontend", "backend", "data", "provider", "worker", "other"] }, role: { type: "string" }, port: { type: "string" }, protocol: { type: "string" }, dependsOn: { type: "array", items: { type: "string" } }, limitations: { type: "array", items: { type: "string" } }, internals: { type: "array", items: { type: "object", properties: { name: { type: "string" }, role: { type: "string" } }, required: ["name", "role"] } } }, required: ["name", "kind", "role"] } },
    flows: { type: "array", items: { type: "object", properties: { name: { type: "string" }, steps: { type: "array", items: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, action: { type: "string" } }, required: ["from", "to", "action"] } } }, required: ["name", "steps"] } },
    drift: { type: "array", items: { type: "object", properties: { claim: { type: "string" }, source: { type: "string" }, status: { type: "string", enum: ["confirmed", "not-found-in-code", "undocumented-capability"] } }, required: ["claim", "source", "status"] } },
  },
  required: ["oneLiner", "goals", "capabilities", "topology", "flows"],
} as const;

function loadGraphSafe(dataDir?: string): Graph | undefined {
  const p = dataDir ? join(dataDir, "graph.json") : undefined;
  if (!p || !existsSync(p)) return undefined;
  try { return JSON.parse(readFileSync(p, "utf-8")) as Graph; } catch { return undefined; }
}

export async function buildRespec(inputs: RespecInputs, outDir: string): Promise<Respec> {
  const graph = loadGraphSafe(inputs.dataDir);
  const surface = inputs.repoRoot ? buildSurface({ repoRoot: inputs.repoRoot, dataDir: inputs.dataDir, docDirs: inputs.docDirs, description: inputs.name }) : { components: [], fileContents: [], source: [] } as ReturnType<typeof buildSurface>;
  const docs = readDocContents(inputs.repoRoot, inputs.docDirs);
  const annotations = loadAnnotations(outDir);

  const screens = graph ? Object.keys(graph.nodes) : [];
  let respec: Respec;

  // Directory evidence per top-level component dir: lets the LLM fill L2
  // internals (deep respec, spec 13.1) without reading every file.
  const dirTrees: string[] = [];
  if (inputs.repoRoot && existsSync(inputs.repoRoot)) {
    for (const top of readdirSync(inputs.repoRoot)) {
      const full = join(inputs.repoRoot, top);
      if (top.startsWith(".") || top === "node_modules" || !statSync(full).isDirectory()) continue;
      const entries: string[] = [];
      const walk = (dir: string, depth: number, prefix: string) => {
        if (depth > 2 || entries.length > 40) return;
        for (const f of readdirSync(dir)) {
          if (f.startsWith(".") || f === "node_modules" || f === "__pycache__" || f === ".next") continue;
          const p = join(dir, f);
          entries.push(prefix + f);
          if (statSync(p).isDirectory()) walk(p, depth + 1, prefix + "  ");
        }
      };
      try { walk(full, 0, "  "); } catch { /* skip */ }
      if (entries.length) dirTrees.push(`${top}/\n${entries.slice(0, 40).join("\n")}`);
    }
  }

  if (isLlmConfigured()) {
    const prompt = [
      `Product: ${inputs.name}`,
      inputs.visionText ? `Vision (human-written):\n${inputs.visionText.slice(0, 4000)}` : "",
      screens.length ? `Discovered screens (live crawl, ground truth): ${screens.join(", ")}` : "",
      surface.components?.length ? `Repo components:\n${surface.components.map((c) => `- ${c.name} (${c.path})${c.externalDeps?.length ? ` deps: ${c.externalDeps.slice(0, 6).join(",")}` : ""}`).join("\n")}` : "",
      surface.fileContents?.length ? `Key files:\n${surface.fileContents.map((f) => `--- ${f.path} ---\n${f.content.slice(0, 4000)}`).join("\n")}` : "",
      docs.length ? `Docs:\n${docs.map((d) => `--- ${d.path} ---\n${d.content.slice(0, 6000)}`).join("\n")}` : "",
      annotations && Object.keys(annotations).length ? `Human annotations (authoritative, keep):\n${Object.entries(annotations).map(([k, v]) => `- ${k}: ${v}`).join("\n")}` : "",
      "",
      "Reverse-engineer this product into a spec. Rules:",
      dirTrees.length ? `Directory trees (evidence for per-component internals):\n${dirTrees.slice(0, 10).join("\n\n")}` : "",
      "- topology components must come from real evidence (docker-compose services, package configs, docs, ports in code). Include kind, role (one sentence), port, protocol, dependsOn.",
      "- For each component, fill `internals` (3-6 sub-parts: routers, workers, stores, pipelines) from its directory tree, and `limitations` (known constraints from docs/README).",
      "- capabilities must reference discovered screens where applicable.",
      "- flows: REQUIRED, never empty - 2-4 key end-to-end flows as from->to->action step lists over topology component names (e.g. an inbound call, a resource creation, a batch job).",
      "- drift: doc/vision claims you could NOT ground in code (not-found-in-code) and code capabilities absent from docs (undocumented-capability). Confirmed claims may be listed as confirmed.",
    ].filter(Boolean).join("\n\n");
    const res = await localChat({
      text: prompt,
      system: "You are a precise software archaeologist. Only state what the evidence supports.",
      tool: { name: "emit_respec", description: "Emit the reverse-engineered product spec", inputSchema: RESPEC_SCHEMA as unknown as Record<string, unknown> },
      maxTokens: 4000,
      model: llmModel(),
    });
    const t = res.toolInput as Partial<Respec> | undefined;
    if (t && t.topology?.length) {
      respec = {
        generatedAt: new Date().toISOString(),
        oneLiner: t.oneLiner ?? inputs.name,
        goals: t.goals ?? [],
        personas: t.personas ?? [],
        capabilities: t.capabilities ?? [],
        topology: t.topology,
        flows: t.flows ?? [],
        drift: t.drift ?? [],
        annotations,
        source: "llm",
      };
    } else {
      respec = heuristicRespec(inputs, screens, surface, annotations);
    }
  } else {
    respec = heuristicRespec(inputs, screens, surface, annotations);
  }

  // Flows are load-bearing (sequence diagrams, scenarios) - when the main
  // call omits them, run a small focused pass just for flows.
  if (!respec.flows.length && isLlmConfigured() && respec.topology.length) {
    const res = await localChat({
      text: [
        `Components of ${inputs.name}: ${respec.topology.map((c) => `${c.name} (${c.kind}: ${c.role})`).join("; ")}`,
        respec.capabilities.length ? `Capabilities: ${respec.capabilities.map((c) => c.name).join("; ")}` : "",
        `Write 3 key end-to-end flows through these components (e.g. the main user action, a resource creation, a background job). Steps use EXACT component names for from/to.`,
      ].filter(Boolean).join("\n"),
      system: "You describe system flows using only the given component names.",
      tool: {
        name: "emit_flows",
        description: "Key end-to-end flows",
        inputSchema: { type: "object", properties: { flows: (RESPEC_SCHEMA.properties.flows as unknown) as Record<string, unknown> }, required: ["flows"] },
      },
      maxTokens: 1200,
      model: llmModel(),
    });
    const t = res.toolInput as { flows?: RespecFlow[] } | undefined;
    if (t?.flows?.length) respec.flows = t.flows;
  }

  // Regeneration resilience: an LLM run that omits sections a previous run
  // had (flows, goals, drift) must not lose them - merge forward.
  const prevPath = join(outDir, "spec.json");
  if (existsSync(prevPath)) {
    try {
      const prev = JSON.parse(readFileSync(prevPath, "utf-8")) as Respec;
      if (!respec.flows.length && prev.flows?.length) respec.flows = prev.flows;
      if (!respec.goals.length && prev.goals?.length) respec.goals = prev.goals;
      if (!respec.personas.length && prev.personas?.length) respec.personas = prev.personas;
      if (!respec.drift.length && prev.drift?.length) respec.drift = prev.drift;
    } catch { /* no previous spec */ }
  }
  writeJson(join(outDir, "spec.json"), respec);
  writeFileSync(join(outDir, "spec.md"), renderRespecMd(respec, inputs.name));
  return respec;
}

function heuristicRespec(inputs: RespecInputs, screens: string[], surface: { components?: Array<{ name: string; path: string }> }, annotations: Record<string, string>): Respec {
  const topology: RespecComponent[] = (surface.components ?? []).map((c) => ({
    name: c.name,
    kind: /front|web|ui|client/i.test(c.name) ? "frontend" : /server|api|backend/i.test(c.name) ? "backend" : /db|mongo|postgres|redis|minio|storage/i.test(c.name) ? "data" : "other",
    role: `component at ${c.path}`,
  }));
  if (!topology.length) topology.push({ name: inputs.name, kind: "frontend", role: "live web app (no source connected - UX-only respec)" });
  return {
    generatedAt: new Date().toISOString(),
    oneLiner: inputs.name,
    goals: [],
    personas: [],
    capabilities: screens.map((s) => ({ name: s, screens: [s] })),
    topology,
    flows: [],
    drift: [],
    annotations,
    source: "heuristic",
  };
}

export function loadAnnotations(outDir: string): Record<string, string> {
  const p = join(outDir, "annotations.json");
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return {}; }
}

export function saveAnnotation(outDir: string, key: string, note: string): Record<string, string> {
  const all = loadAnnotations(outDir);
  if (note) all[key] = note; else delete all[key];
  writeJson(join(outDir, "annotations.json"), all);
  // Reflect into spec.json without a full regeneration.
  const specPath = join(outDir, "spec.json");
  if (existsSync(specPath)) {
    const spec = JSON.parse(readFileSync(specPath, "utf-8")) as Respec;
    spec.annotations = all;
    writeJson(specPath, spec);
    writeFileSync(join(outDir, "spec.md"), renderRespecMd(spec, spec.oneLiner));
  }
  return all;
}

export function renderRespecMd(r: Respec, name: string): string {
  const ann = (key: string) => (r.annotations[key] ? `\n  > human note: ${r.annotations[key]}` : "");
  return [
    `# ${name} - reverse-engineered spec`,
    ``,
    `_Generated ${r.generatedAt} (${r.source})._`,
    ``,
    `**${r.oneLiner}**`,
    ``,
    r.goals.length ? `## Goals\n${r.goals.map((g) => `- ${g}`).join("\n")}` : "",
    r.personas.length ? `## Personas\n${r.personas.map((g) => `- ${g}`).join("\n")}` : "",
    `## Topology`,
    ...r.topology.map((c) => `- **${c.name}** (${c.kind}${c.port ? ` :${c.port}` : ""}${c.protocol ? `, ${c.protocol}` : ""}) - ${c.role}${c.dependsOn?.length ? ` -> depends on ${c.dependsOn.join(", ")}` : ""}${ann(`topology:${c.name}`)}`),
    ``,
    `## Capabilities`,
    ...r.capabilities.map((c) => `- **${c.name}**${c.screens?.length ? ` (screens: ${c.screens.join(", ")})` : ""}${c.services?.length ? ` [services: ${c.services.join(", ")}]` : ""}${ann(`capability:${c.name}`)}`),
    ``,
    r.flows.length ? `## Key flows\n${r.flows.map((f) => `### ${f.name}\n${f.steps.map((s) => `1. ${s.from} -> ${s.to}: ${s.action}`).join("\n")}${ann(`flow:${f.name}`)}`).join("\n\n")}` : "",
    r.drift.length ? `## Drift report\n${r.drift.map((d) => `- [${d.status}] ${d.claim} _(source: ${d.source})_`).join("\n")}` : "",
  ].filter((s) => s !== "").join("\n");
}

function writeJson(p: string, data: unknown): void {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2));
}
