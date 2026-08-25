// Spec: v2 §4.3, §9 - see spec/traceability.md
// Reference session adapter: drives a scripted conversation over the DOM.
//
// Its job is to prove the session contract is genuinely transport-agnostic.
// Spec §4.3 says a `call` scene carries only `sessionKind` + `turns`, and that
// concrete execution is ALWAYS the adapter's - a voice product satisfies it
// over WebSocket + fake mic, a video product over WebRTC, "and a chat
// product's via DOM manipulation". This is that chat case, and it is what lets
// the bridge be built and tested without any product's backend running.
//
// It carries no product knowledge: selectors come from the manifest, so
// pointing it at a different chat UI is configuration, not code.
import type {
  PrimitiveContext,
  PrimitiveInvocation,
  PrimitiveResult,
  ProdlensAdapter,
  ProductSurface,
  ResourceNeed,
  ResourceResolution,
} from "./types.js";
import { registerAdapter } from "./engine.js";

/** Where the conversation lives on screen. Every field is overridable per
 *  product via the manifest; these defaults suit a conventional chat box. */
export interface DomChatSelectors {
  input: string;
  send: string;
  /** Matches every message bubble; the last one is treated as the reply. */
  message: string;
}

const DEFAULTS: DomChatSelectors = {
  input: "textarea, input[type='text'], [contenteditable='true']",
  send: "button[type='submit'], button:has-text('Send')",
  message: "[data-message], .message, li",
};

function selectorsFrom(manifest: Record<string, unknown>): DomChatSelectors {
  const m = (manifest?.domChat ?? {}) as Partial<DomChatSelectors>;
  return { ...DEFAULTS, ...m };
}

/** Wait for a message the product produced, so a turn ends when it actually
 *  answers rather than after a fixed sleep. `ignoreText`, when given, is the
 *  text we just sent: chat UIs usually echo the sent message into the same
 *  list, and that echo is not a reply. Returns the reply text, or undefined if
 *  nothing arrived inside the budget. */
async function waitForReply(
  page: import("playwright").Page,
  sel: DomChatSelectors,
  before: number,
  timeoutMs: number,
  ignoreText?: string,
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await page.locator(sel.message).count().catch(() => before);
    if (count > before) {
      const last = (await page.locator(sel.message).last().innerText().catch(() => undefined))?.trim();
      // Our own echo is not the answer - keep waiting for the next message.
      if (last !== undefined && last !== ignoreText?.trim()) return last;
    }
    await page.waitForTimeout(100);
  }
  return undefined;
}

export const domChatSessionAdapter: ProdlensAdapter = {
  id: "session-dom-chat",
  name: "Scripted DOM chat session (reference)",

  // Opt-in only: this never auto-claims a surface, because a product with a
  // real transport must win selection over the reference driver.
  detect: () => false,

  manifestFields: [
    { key: "domChat.input", type: "string", description: "Selector for the message input" },
    { key: "domChat.send", type: "string", description: "Selector for the send button" },
    { key: "domChat.message", type: "string", description: "Selector matching each message bubble" },
  ],

  sceneTypes: [
    {
      id: "dom-chat",
      description:
        "A scripted conversation in a chat UI: each turn is typed and sent, and the product's reply is waited for. Use as `sessionKind` on a call scene.",
      fields: [
        { key: "turns", type: "string[]", description: "Ordered turns; user turns carry the text to send", required: true },
      ],
    },
  ],

  primitives: [
    {
      op: "dom-chat",
      description: "Run a scripted chat conversation on the current page, one turn per message.",
      args: [{ key: "turns", type: "string[]", description: "Turns to play", required: true }],
    },
  ],

  async resolveResource(need: ResourceNeed, _surface: ProductSurface): Promise<ResourceResolution> {
    return {
      status: "blocked",
      neededFromUser: `${need.resource} (${need.purpose}) - the reference chat adapter needs selectors in manifest.domChat.`,
    };
  },

  async execute(primitive: PrimitiveInvocation, ctx: PrimitiveContext): Promise<PrimitiveResult> {
    if (primitive.op !== "dom-chat") return { ok: false, error: `unknown op ${primitive.op}` };
    const page = ctx.page;
    if (!page) return { ok: false, error: "dom-chat needs a browser page" };

    const sel = selectorsFrom(ctx.manifest ?? {});
    const turns = (primitive.args.turns ?? []) as Array<{ speaker: string; text?: string; bargeIn?: boolean }>;
    const transcript: Array<{ speaker: string; text: string }> = [];

    for (const turn of turns) {
      const before = await page.locator(sel.message).count().catch(() => 0);

      // A turn with no text is the other side's - wait for it rather than send.
      if (!turn.text) {
        const reply = await waitForReply(page, sel, before, 15000);
        if (reply) transcript.push({ speaker: turn.speaker, text: reply });
        continue;
      }

      await page.locator(sel.input).first().fill(turn.text);
      await page.locator(sel.send).first().click({ timeout: 8000 }).catch(async () => {
        // Not every chat box has a send button; Enter is the usual fallback.
        await page.locator(sel.input).first().press("Enter");
      });
      transcript.push({ speaker: turn.speaker, text: turn.text });

      // bargeIn means this speaker cut in before the previous reply finished,
      // so the turn is deliberately NOT awaited.
      if (turn.bargeIn) continue;
      const reply = await waitForReply(page, sel, before, 15000, turn.text);
      if (reply) transcript.push({ speaker: "product", text: reply });
    }

    const path = `${ctx.workDir}/transcript.json`;
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(ctx.workDir, { recursive: true });
    writeFileSync(path, JSON.stringify({ transcript }, null, 2));
    return { ok: true, artifacts: [{ kind: "json", path, label: "transcript" }] };
  },
};

registerAdapter(domChatSessionAdapter);
