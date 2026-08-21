# LLM client

One OpenAI-compatible client (`src/llm/local.ts`) serves **every** AI feature.
No Anthropic, no Muse. Cheap models via your OpenRouter key.

## Configuration

| env | default | purpose |
| --- | --- | --- |
| `LLM_BASE_URL` | `http://localhost:1234` | OpenAI-compatible endpoint. For OpenRouter: `https://openrouter.ai/api` |
| `LLM_API_KEY` | | Bearer token (OpenRouter: one key covers deepseek/qwen/kimi) |
| `LLM_MODEL` | `deepseek/deepseek-v4-flash` | text model (synthesize, gepa, agent fallback) |
| `LLM_VISION_MODEL` | `qwen/qwen2.5-vl-72b-instruct` | vision model (visual QA, demo auto-narrate, guided) |

Examples:

```
LLM_BASE_URL=https://openrouter.ai/api
LLM_API_KEY=sk-or-...
LLM_MODEL=deepseek/deepseek-v4-flash
LLM_VISION_MODEL=qwen/qwen2.5-vl-72b-instruct
```

Any OpenAI-compatible server works - DeepSeek API, Qwen/DashScope, Kimi/Moonshot,
or a local LM Studio/Ollama instance (no key needed for local).

## Client behavior

- **Images** are attached as base64 `data:` URLs in an `image_url` content part.
- **Tools** force `tool_choice` to the single function, mirroring the old
  Anthropic tool-use pattern. Responses parse `tool_calls` -> `toolInput`.
- **Vision defaulting**: when `images` are present and no model is pinned, the
  client defaults to `LLM_VISION_MODEL`; text calls default to `LLM_MODEL`.
- **Auth**: `Authorization: Bearer <key>` when `LLM_API_KEY` is set; harmless
  headers `HTTP-Referer`/`X-Title` are sent for OpenRouter routing.
- **Never throws**: a down endpoint returns `{ error }`; every caller degrades
  to its existing behavior (heuristic fallback, skip, or per-shot error).

## Consumers

| feature | model role | endpoint | fallback when down |
| --- | --- | --- | --- |
| `prioritize` synthesis | text | tool call `emit_synthesis` | heuristic: first N reachable screens |
| `run` agent fallback | text | tool call `choose_element` | fail the step |
| `gepa` reflection | text | chat | heuristic issue-type digest |
| `visual` QA | vision | chat + image | per-shot error, never false finding |
| `demo` auto-narrate | vision | chat + image | step keeps scripted narrate or none |
| `demo` guided | vision | chat + image | stop the walkthrough |

## TTS

Narrated videos (`demo`, `explain`) use a backend chain in `src/execution/explain.ts`:

1. `--tts-cmd` hook
2. Gemini 2.5/3.1 Flash TTS (neural, needs `GEMINI_API_KEY`)
3. local Kokoro-82M (free, `TTS_BACKEND=kokoro`)
4. macOS `say`

`TTS_BACKEND=gemini|kokoro|say` pins a backend; `auto` (default) tries them in
order. `TTS_VOICE_KOKORO` selects the Kokoro voice (default `af_heart`).

The demo pre-synthesizes every narration clip before recording starts, so TTS
latency never appears in the video timeline.
