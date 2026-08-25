# prodlens documentation

> **Docs describe, the spec decides.** These pages explain how prodlens works
> today. The normative specification lives in [`spec/`](../spec/README.md) -
> start at its root index for the document map, precedence rules, and the
> requirement/code trace matrix. Where a doc here disagrees with `spec/`, the
> spec wins and the doc is the bug.

| page | what it covers |
| --- | --- |
| [product.md](product.md) | the complete product description - start here |
| [architecture.md](architecture.md) | component map, control flow, data flow, concurrency & auth |
| [cli-reference.md](cli-reference.md) | every command + flags, demo/explain screenplay formats |
| [data-models.md](data-models.md) | orientation on the core types - normative definitions are in [spec/schemas.md](../spec/schemas.md) |
| [llm-client.md](llm-client.md) | the one OpenAI-compatible client, models, TTS chain |
| [extension-guide.md](extension-guide.md) | add a command, a discovery pass, a TTS backend, an LLM consumer |
| [adapters.md](adapters.md) | adapters + JIT adapter synthesis (LLM codes the SDK from a product's repo) |
| [voicera.md](voicera.md) | a full worked example: VoiceEra's stack, how it runs, the Prodlens run |

A narrated video walkthrough (`data/tutorial/tutorial.mp4`) explains the same
pipeline with a cursor that glides to each stage as it is narrated. Its
screenplay (`data/tutorial/tutorial-screenplay.json`) is itself an example of
the `explain` format with cursor keyframes.

There is also a VoiceEra-specific tutorial
(`data/projects/voicera/tutorial/voicera-tutorial.mp4`) whose cursor points at
each service as the architecture is narrated.
