// Review form for the LLM-drafted walkthrough + manifest. Shows the proposed
// scenes, narration, primitives, and the resource checklist; lets the user
// approve, edit narration, toggle scenes on/off, and reject - before anything
// renders. Mirrors the `review` command's interactive state machine.
import { createInterface } from "node:readline/promises";
import type { ResourceResolution, SceneSpec, WalkthroughPlan } from "./types.js";

export interface ReviewedPlan extends WalkthroughPlan {
  /** Scenes the user kept (approved). */
  scenes: SceneSpec[];
}

export async function reviewWalkthroughInteractive(
  plan: WalkthroughPlan,
  resources: Record<string, ResourceResolution>
): Promise<ReviewedPlan> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const kept: SceneSpec[] = [];
  try {
    console.log(`\n=== Walkthrough review: ${plan.title} ===`);
    console.log(`Modes: ${plan.mode.join(", ")} | ${plan.scenes.length} scene(s)`);

    if (Object.keys(resources).length) {
      console.log("\nResources:");
      for (const [id, r] of Object.entries(resources)) {
        const mark = r.status === "satisfied" ? "OK" : r.status === "obtainable" ? "obtainable" : "BLOCKED";
        console.log(`  [${mark}] ${id}${r.how ? ` - ${r.how}` : ""}${r.neededFromUser ? ` - NEEDS: ${r.neededFromUser}` : ""}`);
      }
      const anyBlocked = Object.values(resources).some((r) => r.status === "blocked");
      if (anyBlocked) {
        console.log("\nBlocked resources - the run can't complete until these are supplied.");
      }
    }

    for (let i = 0; i < plan.scenes.length; i++) {
      const s = plan.scenes[i];
      console.log(`\n--- Scene ${i + 1}/${plan.scenes.length}: ${s.name} ---`);
      console.log(`  narrate: ${s.narrate ?? "(none)"}`);
      for (const p of s.primitives) console.log(`  action: ${p.op} ${JSON.stringify(p.args)}`);
      for (const n of s.needs ?? []) console.log(`  needs: ${n.resource} (${n.purpose})`);
      if (s.cursor?.length) console.log(`  cursor: ${s.cursor.length} keyframe(s)`);

      for (;;) {
        let answer = "";
        try {
          answer = (await rl.question("  (a)ccept / (s)kip / (e)dit narration / (q)uit review? ")).trim().toLowerCase();
        } catch {
          // EOF on stdin (e.g. piped input ran out) - stop reviewing, keep
          // what's accepted so far.
          return { ...plan, scenes: kept };
        }
        if (answer === "a" || answer === "accept") {
          kept.push(s);
          break;
        }
        if (answer === "s" || answer === "skip") break;
        if (answer === "e" || answer === "edit") {
          let newNarrate = "";
          try {
            newNarrate = (await rl.question("  new narration (blank = keep): ")).trim();
          } catch {
            return { ...plan, scenes: kept };
          }
          if (newNarrate) s.narrate = newNarrate;
          continue;
        }
        if (answer === "q" || answer === "quit") return { ...plan, scenes: kept };
        console.log('  type "a", "s", "e", or "q"');
      }
    }
  } finally {
    rl.close();
  }
  return { ...plan, scenes: kept };
}
