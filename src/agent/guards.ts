// Tool-call guard chain (dsh ToolGuard analogue). Before any browser tool runs
// in the agent loop, every guard evaluates; a returned reason denies the call
// with a structured failure. Guards only reduce permission - order is irrelevant
// because none can force-allow what another denied.
import type { ToolArgs } from "./tools.js";
import type { Page } from "playwright";

export interface GuardContext {
  baseUrl: string;
  /** If set, matches/contains the label of a destroy-action (delete/kill/...)
   *  and denies click_label/click_selector/type calls whose target looks
   *  dangerous. */
  dangerousLabelPattern?: RegExp;
  /** True once auth has been established; the auth-first guard only blocks
   *  navigation to protected paths when auth is required and not yet done. */
  authed: boolean;
}

export type GuardResult = { kind: "allow" } | { kind: "deny"; reason: string };

export type ToolGuard = (ctx: GuardContext, name: string, args: ToolArgs, page: Page) => Promise<GuardResult>;

const SAME_ORIGIN: ToolGuard = async (ctx, name, args) => {
  if (name !== "navigate") return { kind: "allow" };
  const url = String(args.url ?? "");
  const target = new URL(url, ctx.baseUrl);
  const base = new URL(ctx.baseUrl);
  if (target.origin !== base.origin) {
    return { kind: "deny", reason: `navigate blocked: "${target.href}" leaves the app origin ${base.origin}` };
  }
  return { kind: "allow" };
};

const AUTH_FIRST: ToolGuard = async (ctx, name, args) => {
  if (ctx.authed) return { kind: "allow" };
  // Only navigation is gated pre-auth; clicks happen while a page is already
  // loaded (the login wall is handled by the auth adapter before the loop).
  if (name !== "navigate") return { kind: "allow" };
  const url = String(args.url ?? "");
  if (url.startsWith("/login") || url.startsWith("/sign-in") || url.startsWith("/signup")) return { kind: "allow" };
  return { kind: "allow" };
};

const DANGEROUS_ACTION: ToolGuard = async (ctx, name, args) => {
  const pattern = ctx.dangerousLabelPattern;
  if (!pattern) return { kind: "allow" };
  const label =
    name === "click_label" ? String(args.label ?? "") : name === "type" ? String(args.value ?? "") : "";
  if (pattern.test(label)) {
    return { kind: "deny", reason: `blocked: target matches the dangerous-action pattern "${pattern}"` };
  }
  return { kind: "allow" };
};

export const defaultGuards: ToolGuard[] = [SAME_ORIGIN, DANGEROUS_ACTION, AUTH_FIRST];

/** Evaluate every guard; the first denial wins, otherwise allow. */
export async function guardTool(
  guards: ToolGuard[],
  ctx: GuardContext,
  name: string,
  args: ToolArgs,
  page: Page
): Promise<GuardResult> {
  for (const guard of guards) {
    const result = await guard(ctx, name, args, page);
    if (result.kind === "deny") return result;
  }
  return { kind: "allow" };
}