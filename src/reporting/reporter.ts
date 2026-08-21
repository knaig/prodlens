import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Graph, GraphAnalysis, VerificationReport } from "../types.js";

// Renders findings with a plain-English layer first: an executive summary in
// user terms, then each section introduced with what it means and why it
// matters, then the technical detail for the reader who wants to go deeper.
// The goal is that someone who has never seen the tool can read a report and
// tell whether their app is okay or broken.

/** One-line explanation of each finding category, used under section headers. */
const GLOSSARY: Record<string, string> = {
  dead: "A button or link that renders on screen but does nothing when clicked - it has no click handler, no link target, and no form action. Users click, nothing happens.",
  localStateOnly: "A button or control that only changes what's visible on the page (e.g. opens a dialog, filters a list) and never saves anything. Some of these are intentional UI toggles; some are features where the save/persist step is missing. Worth a human look.",
  brokenEdges: "A click or tap that should move you somewhere but doesn't - the page stays put, or the action errors out.",
  unreachable: "A screen that exists in the app but no button, link, or redirect anywhere in the app connects to it. The only way in is typing the URL directly.",
  deadEnd: "A screen you can reach, but from which there's no button or link to go anywhere else. A dead end for the user.",
  missingReturnPath: "A one-way street: some screens lead here, but there's no way for a user to navigate back out.",
};

function friendlyNumber(n: number): string {
  return n === 1 ? "1 item" : `${n} items`;
}

export function renderMarkdownReport(graph: Graph, analysis: GraphAnalysis, appName: string): string {
  const lines: string[] = [];
  const nodeCount = Object.keys(graph.nodes).length;

  lines.push(`# prodlens report: ${appName}`, "");
  lines.push(`Generated ${new Date().toISOString()}`, "");

  const problems = analysis.deadStaticElements.length + analysis.brokenEdges.length + analysis.unreachableNodes.length + analysis.deadEndNodes.length;
  const verdict = problems === 0 ? "Looking good - no problems found." : `There are problems to look at (${problems} finding${problems === 1 ? "" : "s"} below).`;

  lines.push("## What this report says", "");
  lines.push(
    `This report treats the app as a map: it finds every screen, every button and link on those screens (${nodeCount}), ` +
      `clicks or follows them the way a user would, and records what actually happens.`
  );
  lines.push("");
  lines.push(`**Verdict: ${verdict}**`, "");
  lines.push("In plain terms:");
  lines.push("");
  lines.push(`- **${nodeCount} screens** found in the app.`);
  if (analysis.unreachableNodes.length)
    lines.push(`- **${friendlyNumber(analysis.unreachableNodes.length)}:** ${analysis.unreachableNodes.length === 1 ? "a screen exists that nothing links to" : "screens exist that nothing links to"}. ${GLOSSARY.unreachable}`);
  if (analysis.deadEndNodes.length)
    lines.push(`- **${friendlyNumber(analysis.deadEndNodes.length)}:** ${analysis.deadEndNodes.length === 1 ? "a screen is" : "screens are"} a dead end: reachable, but with no way to navigate out. ${GLOSSARY.deadEnd}`);
  if (analysis.deadStaticElements.length)
    lines.push(`- **${friendlyNumber(analysis.deadStaticElements.length)}:** ${analysis.deadStaticElements.length === 1 ? "a button or link looks" : "buttons or links look"} clickable but do nothing. ${GLOSSARY.dead}`);
  if (analysis.brokenEdges.length)
    lines.push(`- **${friendlyNumber(analysis.brokenEdges.length)}:** ${analysis.brokenEdges.length === 1 ? "a transition that should navigate" : "transitions that should navigate"} fail to do so. ${GLOSSARY.brokenEdges}`);
  if (analysis.missingReturnPaths.length)
    lines.push(`- **${friendlyNumber(analysis.missingReturnPaths.length)}:** ${analysis.missingReturnPaths.length === 1 ? "a one-way trip: you can get" : "one-way trips: you can get"} to a screen but can't click your way back out. ${GLOSSARY.missingReturnPath}`);
  if (analysis.localStateOnlyElements.length)
    lines.push(`- **${friendlyNumber(analysis.localStateOnlyElements.length)}:** ${analysis.localStateOnlyElements.length === 1 ? "a button only affects" : "buttons only affect"} the page you're on (dialogs, filters) and never persist anything. ${GLOSSARY.localStateOnly}`);
  lines.push("");

  if (analysis.deadStaticElements.length) {
    lines.push(`## Dead buttons & links (${analysis.deadStaticElements.length})`, "");
    lines.push("_What this means: " + GLOSSARY.dead + "_", "");
    lines.push("Detail - each one and where it lives in source:", "");
    for (const e of analysis.deadStaticElements) {
      lines.push(`- **${e.action}** — \`${e.sourceFile}:${e.sourceLine}\` (screen: \`${e.from}\`)`);
    }
    lines.push("");
  }

  if (analysis.brokenEdges.length) {
    lines.push(`## Broken transitions (${analysis.brokenEdges.length})`, "");
    lines.push("_What this means: " + GLOSSARY.brokenEdges + "_", "");
    for (const e of analysis.brokenEdges.filter((e) => e.staticClassification !== "dead")) {
      lines.push(`- **${e.action}** on \`${e.from}\` → \`${e.to ?? "unresolved target"}\`${e.error ? ` — ${e.error}` : ""}`);
    }
    lines.push("");
  }

  if (analysis.unreachableNodes.length) {
    lines.push(`## Unreachable screens (${analysis.unreachableNodes.length})`, "");
    lines.push("_What this means: " + GLOSSARY.unreachable + "_", "");
    for (const id of analysis.unreachableNodes) {
      const node = graph.nodes[id];
      lines.push(`- \`${id}\`${node?.sourceFile ? ` — ${node.sourceFile}` : ""}`);
    }
    lines.push("");
  }

  if (analysis.deadEndNodes.length) {
    lines.push(`## Dead-end screens (${analysis.deadEndNodes.length})`, "");
    lines.push("_What this means: " + GLOSSARY.deadEnd + "_", "");
    lines.push("Reachable, but no outgoing navigation found from them (aside from shared app chrome, if any).");
    lines.push("");
    for (const id of analysis.deadEndNodes) lines.push(`- \`${id}\``);
    lines.push("");
  }

  if (analysis.missingReturnPaths.length) {
    lines.push(`## Missing return paths (${analysis.missingReturnPaths.length})`, "");
    lines.push("_What this means: " + GLOSSARY.missingReturnPath + "_", "");
    for (const { from, to } of analysis.missingReturnPaths) {
      lines.push(`- \`${from}\` → \`${to}\`, but no way found back to \`${from}\``);
    }
    lines.push("");
  }

  if (analysis.localStateOnlyElements.length) {
    lines.push(`## Local-state-only elements - manual triage (${analysis.localStateOnlyElements.length})`, "");
    lines.push("_What this means: " + GLOSSARY.localStateOnly + "_", "");
    lines.push("These onClick handlers only touch local component state — never call a server action or navigate. Not auto-flagged as broken, because some are intentionally UI-only.", "");
    for (const e of analysis.localStateOnlyElements) {
      lines.push(`- **${e.action}** — \`${e.sourceFile}:${e.sourceLine}\` (screen: \`${e.from}\`)`);
    }
    lines.push("");
  }

  // Technical appendix: full counts so nothing is lost from the raw graph.
  lines.push("## Appendix - raw numbers", "");
  lines.push(`- Screens discovered: ${nodeCount}`);
  lines.push(`- Unreachable screens: ${analysis.unreachableNodes.length}`);
  lines.push(`- Dead-end screens: ${analysis.deadEndNodes.length}`);
  lines.push(`- Dead interactive elements: ${analysis.deadStaticElements.length}`);
  lines.push(`- Broken edges: ${analysis.brokenEdges.length}`);
  lines.push(`- Missing return paths: ${analysis.missingReturnPaths.length}`);
  lines.push(`- Local-state-only elements (needs manual triage): ${analysis.localStateOnlyElements.length}`);
  lines.push("");

  return lines.join("\n");
}

/** Renders the full-pipeline VerificationReport (Stage 6/7): intended-vs-actual
 *  diff summary + prioritized issue list with evidence, with a plain-English
 *  summary up front. */
export function renderVerificationMarkdown(report: VerificationReport, appName: string): string {
  const lines: string[] = [];
  lines.push(`# prodlens verification report: ${appName}`, "");
  lines.push(`Generated ${report.generatedAt}`, "");

  const criticals = report.issues.filter((i) => i.severity === "critical");
  const highs = report.issues.filter((i) => i.severity === "high");
  const mediums = report.issues.filter((i) => i.severity === "medium");
  const lows = report.issues.filter((i) => i.severity === "low");

  lines.push("## What this report says", "");
  lines.push("We took the planned journeys (screens to visit in order), replayed them against the live app, and compared what actually happened with what we expected.", "");
  lines.push(`- **${report.summary.nodesCovered} of ${report.summary.nodesCovered + report.summary.deadEnds} screens** behaved as expected.`);
  lines.push(`- **${report.summary.brokenTransitions} broken transition(s)** — a click that should have been observed not going anywhere.`);
  lines.push(`- **${report.summary.missingReturnPaths} missing return path(s)** — a planned screen reachable, but with no way back.`);
  lines.push(`- **${report.summary.deadEnds} dead-end screen(s)**.`);
  if (report.issues.length) {
    lines.push("");
    lines.push(`Verdict: **${report.issues.length} issue${report.issues.length === 1 ? "" : "s"} found** (${criticals.length} critical, ${highs.length} high, ${mediums.length} medium, ${lows.length} low).`);
  }
  lines.push("");

  const bySeverity = { critical: criticals, high: highs, medium: mediums, low: lows };
  const severityPlain = {
    critical: "Things a user will definitely hit and that block the flow - fix before this ship.",
    high: "Likely user-facing problems - a journey can't complete as intended.",
    medium: "Worth a look: uncomfortable, but may be deliberate.",
    low: "Minor / cosmetic or a judgment call.",
  } as const;

  lines.push("## Issues", "");
  if (!report.issues.length) {
    lines.push("_None found._", "");
  } else {
    for (const severity of ["critical", "high", "medium", "low"] as const) {
      if (!bySeverity[severity].length) continue;
      lines.push(`### ${severity[0].toUpperCase()}${severity.slice(1)} (${bySeverity[severity].length})`, "");
      lines.push(`_${severityPlain[severity]}_`, "");
      for (const issue of bySeverity[severity]) {
        const scope = [...(issue.nodeIds ?? []), ...(issue.edgeIds ?? []), ...(issue.pathId ? [issue.pathId] : [])].join(", ");
        lines.push(`- **${issue.title}** (${issue.type})${scope ? ` — \`${scope}\`` : ""}`);
        lines.push(`  ${issue.description}`);
      }
      lines.push("");
    }
  }

  if (report.graphDiff) {
    const d = report.graphDiff;
    lines.push("## Graph diff (intended vs actual)", "");
    lines.push("_What this means: what we expected to happen vs what actually happened._", "");
    lines.push(`- Added nodes: ${d.addedNodes.length}`);
    lines.push(`- Removed (unreached) nodes: ${d.removedNodes.length}`);
    lines.push(`- Added edges: ${d.addedEdges.length}`);
    lines.push(`- Removed edges: ${d.removedEdges.length}`);
    lines.push(`- Changed edges: ${d.changedEdges.length}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function writeReport(markdown: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, markdown);
}