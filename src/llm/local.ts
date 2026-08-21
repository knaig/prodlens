// Shared client for any OpenAI-compatible chat completions endpoint (DeepSeek,
// Qwen/DashScope, Kimi/Moonshot, LM Studio, Ollama, ...). Used by the visual QA
// pass (src/visual/triage.ts), the demo guided walkthrough
// (src/execution/demo.ts), journey synthesis (src/prioritization/synthesize.ts),
// the GEPA reflection (src/prioritization/gepa.ts), and the execution agent
// fallback (src/execution/agent-fallback.ts). This module never throws for a
// network/parse failure - every caller degrades to its existing behavior when
// the endpoint is unreachable, so a down provider is never a crash.
import { readFileSync, existsSync } from "node:fs";

export interface LocalChatOptions {
  text: string;
  system?: string;
  /** Absolute paths to PNG files to attach as base64 data URLs. */
  images?: string[];
  /** When set, the model is forced to pick exactly one tool that returns the
   *  given schema, mirroring the Anthropic tool-use pattern used elsewhere. */
  tool?: { name: string; description: string; inputSchema: Record<string, unknown> };
  maxTokens?: number;
  temperature?: number;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  signal?: AbortSignal;
}

export interface LocalChatResult {
  /** Assistant text. Empty when the model spent its whole budget reasoning. */
  content: string;
  /** The model's pre-answer reasoning (`reasoning_content`), when present. */
  reasoning: string;
  /** If a `tool` was supplied and the model used it, the parsed arguments. */
  toolInput?: Record<string, unknown>;
  error?: string;
}

export function llmBaseUrl(): string {
  return process.env.LLM_BASE_URL ?? "http://localhost:1234";
}

/** Text model for the non-vision LLM paths (synthesis, GEPA, agent fallback). */
export function llmModel(): string {
  return process.env.LLM_MODEL ?? "deepseek-chat";
}

/** Vision-capable model for screenshot-reading paths (visual QA, guided demo). */
export function llmVisionModel(): string {
  return process.env.LLM_VISION_MODEL ?? "qwen-vl-max";
}

export function llmApiKey(): string | undefined {
  return process.env.LLM_API_KEY;
}

/** True when an API key is configured for the chat endpoint. Providers that
 *  need no auth (local servers) are considered configured. */
export function isLlmConfigured(): boolean {
  return Boolean(process.env.LLM_API_KEY || process.env.LLM_BASE_URL);
}

/** True when the endpoint is up and advertises the configured model.
 *  Cheap probe (2s timeout, no images, no completion) - call before paying for
 *  a full inference round trip if your flow has a graceful fallback. */
export async function isLlmReachable(opts: { baseUrl?: string; model?: string } = {}): Promise<boolean> {
  const baseUrl = opts.baseUrl ?? llmBaseUrl();
  const model = opts.model ?? llmModel();
  try {
    const res = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const json = (await res.json()) as { data?: { id?: string }[] };
    return (json.data ?? []).some((m) => m.id === model);
  } catch {
    return false;
  }
}

/** One chat completion against the endpoint. Attaches images as data URLs,
 *  optionally forces a tool call, and reads `content` (falling back to
 *  `reasoning_content` when the model ran out of budget mid-reasoning).
 *  Network/validation failures produce `{ error }`, never a reject. */
export async function localChat(opts: LocalChatOptions): Promise<LocalChatResult> {
  const baseUrl = opts.baseUrl ?? llmBaseUrl();
  // Image requests need a vision-capable model - default to LLM_VISION_MODEL
  // when images are attached and the caller didn't pin a model explicitly.
  const model = opts.model ?? (opts.images?.length ? llmVisionModel() : llmModel());

  // Metering (estimate ledger): one cost event per call, attributed to the
  // active project context. Never throws; the ledger is fire-and-forget.
  try {
    const { recordCost } = await import("../usage/ledger.js");
    recordCost(opts.images?.length ? "vision_llm" : "llm", `llm:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`, Math.max(1, opts.images?.length ?? 1), { note: model });
  } catch { /* ledger unavailable - never block inference */ }

  try {
    const result = await request(baseUrl, model, opts, {});
    if (result.error && result.error.includes("field must be a non-empty string") && (opts.images ?? []).length) {
      // Some servers reject a user message that mixes text + image parts
      // ("'text' field must be a non-empty string") even though both are
      // individually valid - behavior that depends on its session state. Retry
      // with the image alone in one user turn and the instruction as a
      // follow-up turn, the shape some servers demonstrably accept while still
      // asking for structured output.
      return await request(baseUrl, model, opts, { imagesOnlyUser: true, followUpText: opts.text });
    }
    return result;
  } catch (e) {
    return { content: "", reasoning: "", error: e instanceof Error ? e.message : String(e) };
  }
}

async function request(
  baseUrl: string,
  model: string,
  opts: LocalChatOptions,
  retryShape: { imagesOnlyUser?: boolean; followUpText?: string }
): Promise<LocalChatResult> {
  const userTextPart: { type: "text" | "image_url"; text?: string; image_url?: { url: string } }[] =
    retryShape.imagesOnlyUser ? [] : [{ type: "text", text: opts.text }];
  let imageParts: { type: "image_url"; image_url: { url: string } }[] = [];
  try {
    imageParts = (opts.images ?? [])
      .filter((p) => existsSync(p))
      .map((p) => ({ type: "image_url" as const, image_url: { url: `data:image/png;base64,${readFileSync(p).toString("base64")}` } }));
  } catch {
    imageParts = [];
  }

  const messages: { role: "system" | "user"; content: unknown }[] = [];
  if (opts.system) messages.push({ role: "system", content: [{ type: "text" as const, text: opts.system }] });
  messages.push({ role: "user", content: [...userTextPart, ...imageParts] });
  if (retryShape.followUpText) messages.push({ role: "user", content: [{ type: "text" as const, text: retryShape.followUpText }] });

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: opts.maxTokens ?? 512,
    temperature: opts.temperature ?? 0,
  };
  if (opts.tool) {
    body["tools"] = [{ type: "function", function: { name: opts.tool.name, description: opts.tool.description, parameters: opts.tool.inputSchema } }];
    body["tool_choice"] = { type: "function", function: { name: opts.tool.name } };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = opts.apiKey ?? llmApiKey();
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  // OpenRouter requires/uses these to route requests; harmless for other
  // OpenAI-compatible servers (DeepSeek/DashScope/Moonshot/local).
  headers["HTTP-Referer"] = "https://prodlens";
  headers["X-Title"] = "prodlens";

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      // keep the status-only fallback below
    }
    return { content: "", reasoning: "", error: detail || `local LLM server returned ${res.status}` };
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string; reasoning_content?: string; tool_calls?: { function?: { name?: string; arguments?: string } }[] }; finish_reason?: string }[];
  };
  const message = json.choices?.[0]?.message;
  const finish = json.choices?.[0]?.finish_reason;
  const content = message?.content ?? "";
  const reasoning = message?.reasoning_content ?? "";

  let toolInput: Record<string, unknown> | undefined;
  if (message?.tool_calls?.length) {
    for (const tc of message.tool_calls) {
      try {
        toolInput = JSON.parse(tc.function?.arguments ?? "{}") as Record<string, unknown>;
        if (toolInput) break;
      } catch {
        // fall through to the next tool call
      }
    }
  }

  // The model spent its whole budget reasoning (the server returns empty content
  // + finish_reason "length" then) - surface the reasoning so callers can
  // still scrape an answer instead of silently getting a blank.
  if (!content && toolInput === undefined && finish === "length" && reasoning) {
    return { content: "", reasoning, error: "local LLM ran out of tokens reasoning before answering" };
  }
  return { content, reasoning, toolInput };
}
