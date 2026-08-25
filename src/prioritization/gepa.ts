// Spec: FR-GEPA-3, FR-VE-5 - see spec/traceability.md
// GEPA offline optimization loop (README roadmap) over TraceFeedback:
// `report` (index.ts) accumulates TraceFeedback into <dir>/traces.json;
// the `gepa` command reflects on the accumulated traces - via an LLM if
// configured (see isLlmConfigured), a heuristic digest otherwise - into
// guidance text that synthesize.ts's LLM prompt picks up on the next
// `prioritize` run (SynthesisOptions.gepaGuidance). Deliberately a manual CLI
// step you run between verify cycles, not an automatic background loop.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isLlmConfigured, localChat } from "../llm/local.js";
import type { GepaGuidance, TraceFeedback } from "../types.js";

export function appendTraceFeedback(feedback: TraceFeedback[], dir: string): void {
  if (!feedback.length) return;
  const path = join(dir, "traces.json");
  const existing = loadTraceFeedback(dir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify([...existing, ...feedback], null, 2));
}

export function loadTraceFeedback(dir: string): TraceFeedback[] {
  const path = join(dir, "traces.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : [];
}

export function loadLatestGuidance(dir: string): GepaGuidance | undefined {
  const path = join(dir, "gepa", "guidance.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : undefined;
}

export async function runGepaReflection(dir: string, opts: { model?: string } = {}): Promise<GepaGuidance> {
  const traces = loadTraceFeedback(dir);
  const previous = loadLatestGuidance(dir);
  const guidanceText = isLlmConfigured()
    ? await reflectWithLLM(traces, previous, opts.model)
    : reflectHeuristically(traces, previous);

  const guidance: GepaGuidance = {
    version: (previous?.version ?? 0) + 1,
    guidance: guidanceText,
    createdAt: new Date().toISOString(),
    basedOnTraceCount: traces.length,
  };
  const path = join(dir, "gepa", "guidance.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(guidance, null, 2));
  return guidance;
}

function reflectHeuristically(traces: TraceFeedback[], previous?: GepaGuidance): string {
  if (!traces.length) return previous?.guidance ?? "No prior traces yet - nothing to learn from.";
  const failing = traces.filter((t) => t.score < 1);
  const issueTypeCounts = new Map<string, number>();
  for (const t of failing) {
    for (const example of t.examples ?? []) {
      const type = example?.type;
      if (typeof type === "string") issueTypeCounts.set(type, (issueTypeCounts.get(type) ?? 0) + 1);
    }
  }
  const ranked = [...issueTypeCounts.entries()].sort((a, b) => b[1] - a[1]);
  const lines = [`Heuristic digest of ${traces.length} run(s) (${failing.length} with issues) - no LLM configured for a real reflection:`];
  for (const [type, count] of ranked.slice(0, 5)) lines.push(`- "${type}" issues occurred ${count}x - deprioritize journeys that resemble these.`);
  return lines.join("\n");
}

async function reflectWithLLM(traces: TraceFeedback[], previous: GepaGuidance | undefined, model?: string): Promise<string> {
  if (!traces.length) return previous?.guidance ?? "No prior traces yet - nothing to learn from.";
  const summary = traces
    .slice(-20) // most recent 20 - bound prompt size
    .map((t) => `- [${t.module}] score=${t.score.toFixed(2)}: ${t.feedback} (${t.traceSummary})`)
    .join("\n");

  const res = await localChat({
    model,
    maxTokens: 1024,
    system:
      "You are the reflection step of a GEPA-style optimization loop for prodlens' journey synthesis prompt.",
    text:
      `Here is feedback from recent verification runs:\n\n${summary}\n\n` +
      (previous ? `Previous guidance (v${previous.version}):\n${previous.guidance}\n\n` : "") +
      `Write updated, concise guidance (a few plain-text bullet points, no markdown headers) to append to the ` +
      `journey-synthesis prompt so future runs propose journeys more likely to catch real issues and less ` +
      `likely to repeat past mistakes. Respond with ONLY the guidance text.`,
  });

  const text = res.content.trim();
  return text || previous?.guidance || "LLM reflection returned no text.";
}
