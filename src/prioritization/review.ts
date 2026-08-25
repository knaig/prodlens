// Spec: FR-HITL-2, FR-HITL-4, v2 §6 G4 - see spec/traceability.md
// Manual review gate (README roadmap): a state machine sitting between
// `prioritize` and `run` - every path starts "planned"; `review` moves it to
// "approved" or "skipped" (this codebase's PrioritizedPath.status has no
// separate "rejected" state, and "skipped" already means exactly what a
// rejected-and-excluded-from-run path needs), or leaves it "planned" to
// revisit later. `run` (index.ts) refuses to execute any path still
// "planned" unless --skip-review is passed.
import { createInterface } from "node:readline/promises";
import type { PrioritizedPath } from "../types.js";

export async function reviewPathsInteractive(paths: PrioritizedPath[]): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (const p of paths) {
      if (p.status !== "planned") {
        console.log(`[already ${p.status}] ${p.goal}`);
        continue;
      }
      console.log(`\n[${p.priority}] ${p.goal}`);
      console.log(`  reason: ${p.reason}`);
      p.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s.action}`));

      for (;;) {
        const answer = (await rl.question("  (a)pprove / (r)eject / (s)kip for now / (e)dit goal / (q)uit review? ")).trim().toLowerCase();
        if (answer === "a" || answer === "approve") {
          p.status = "approved";
          break;
        }
        if (answer === "r" || answer === "reject") {
          p.status = "skipped";
          break;
        }
        if (answer === "s" || answer === "skip") break; // stays "planned"
        if (answer === "e" || answer === "edit") {
          const newGoal = (await rl.question("  new goal text: ")).trim();
          if (newGoal) p.goal = newGoal;
          continue; // re-prompt approve/reject/skip for the edited path
        }
        if (answer === "q" || answer === "quit") return;
        console.log('  type "a", "r", "s", "e", or "q"');
      }
    }
  } finally {
    rl.close();
  }
}
