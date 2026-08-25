// Spec: FR-VE-2 - see spec/traceability.md
// Goal-oriented agent fallback (README roadmap): when a PathStep's edge has
// no resolvable selector/quoted label/href - or the DOM-based resolution in
// performEdgeAction fails at runtime (element renamed, moved, hidden behind
// a different flow) - ask an LLM to pick the best clickable element on the
// current page for the step's goal, instead of just failing the step.
// Requires a configured LLM (see isLlmConfigured); callers should treat a
// false `clicked` the same as any other step failure.
import type { Page } from "playwright";
import { localChat } from "../llm/local.js";
import { isLlmConfigured } from "../llm/local.js";

export interface AgentFallbackResult {
  clicked: boolean;
  label?: string;
  error?: string;
}

const NONE = "__none__";

export async function agentFallbackClick(page: Page, goal: string, action: string, model?: string): Promise<AgentFallbackResult> {
  if (!isLlmConfigured()) return { clicked: false, error: "agent fallback unavailable - no LLM configured" };

  const candidates = await collectClickable(page);
  if (!candidates.length) return { clicked: false, error: "agent fallback found no clickable elements on the page" };

  const tool = {
    name: "choose_element",
    description: "Pick the clickable element on this page that best accomplishes the goal, or __none__ if nothing plausibly does.",
    inputSchema: {
      type: "object",
      properties: {
        label: { type: "string", enum: [...candidates, NONE], description: "Exact label of the chosen element, or __none__." },
        reason: { type: "string" },
      },
      required: ["label", "reason"],
    },
  };

  const res = await localChat({
    model,
    maxTokens: 512,
    tool,
    system: "You help a UI test recover when a step's expected element is missing.",
    text:
      `A UI test is stuck on this step: "${action}" (path goal: "${goal}").\n` +
      `The intended selector/label could not be resolved on the current page. Here are the clickable ` +
      `elements visible right now:\n${candidates.map((c) => `- "${c}"`).join("\n")}\n\n` +
      `Pick the one that best accomplishes the step, or ${NONE} if none plausibly do.`,
  });

  const chosen = res.toolInput?.label as string | undefined;
  if (res.error || !chosen || chosen === NONE || !candidates.includes(chosen)) {
    return { clicked: false, error: `agent fallback found no suitable element (chose "${chosen ?? "none"}")` };
  }

  try {
    await clickByText(page, chosen);
    return { clicked: true, label: chosen };
  } catch (e) {
    return { clicked: false, label: chosen, error: e instanceof Error ? e.message : String(e) };
  }
}

async function collectClickable(page: Page): Promise<string[]> {
  const labels = await page
    .$$eval("a, button, [role='button']", (els) => els.map((el) => (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60)))
    .catch(() => [] as string[]);
  return [...new Set(labels.filter((t) => t.length > 0))].slice(0, 40); // cap prompt size
}

async function clickByText(page: Page, label: string): Promise<void> {
  const byLink = page.getByRole("link", { name: label, exact: true }).first();
  if (await byLink.isVisible().catch(() => false)) return byLink.click({ timeout: 5000 });
  const byButton = page.getByRole("button", { name: label, exact: true }).first();
  if (await byButton.isVisible().catch(() => false)) return byButton.click({ timeout: 5000 });
  await page.getByText(label, { exact: true }).first().click({ timeout: 5000 });
}
