---
name: openfusion-provider-adapter
description: Use when adding a new LLM provider to the Open Fusion gateway (OpenAI, Anthropic, Google, Azure OpenAI, AWS Bedrock, a local/self-hosted model server, or any other Vercel-AI-SDK-supported provider) or when modifying the existing OpenRouter adapter. Triggers on requests like "add support for provider X", "wire up a new provider adapter", "let the gateway call Anthropic directly", or any change to the provider-config `type` field, `providers.*` block, or the provider capability list. Not for changing the routing/orchestration logic itself (use openfusion-routing-engine) or the config file schema in general (use openfusion-config-schema).
---

# Adding or changing an Open Fusion provider adapter

Per ADR 0007 and spec 004, Open Fusion isolates every LLM provider behind a provider-adapter layer so controllers and the orchestration service never depend on a specific provider's SDK. OpenRouter is the only officially supported provider in the MVP; everything here also applies when extending or hardening that OpenRouter adapter.

## The adapter contract

Every provider adapter must supply, at minimum (spec 004):

- **Model construction** — turn a config entry (`providers.<name>` + a `models.*` entry pointing at it) into a Vercel AI SDK model instance.
- **Non-streaming call** support.
- **Streaming call** support, when the provider allows it.
- **Tool calling** support, when the provider/model allows it — and a clean "unsupported" signal when it doesn't, rather than a raw SDK throw.
- **Error normalization** — provider-specific errors (auth failure, rate limit, timeout, malformed response, unsupported feature) get mapped to the gateway's normalized error shape (see `openfusion-openai-contract` for the public envelope) before they leave the adapter boundary.
- **Usage metadata normalization** — token usage surfaced in whatever shape the provider returns gets converted to the gateway's common usage fields, or omitted cleanly when unavailable.

## Steps to add a new provider (spec 004's own checklist)

1. Implement the adapter satisfying the contract above.
2. Register its `type` string in the providers module so `providers.<name>.type` in the JSON config resolves to this adapter.
3. Add config validation for that `type` (see `openfusion-config-schema` — new provider types typically need their own Zod/schema branch for required fields like `apiKeyEnv`, `baseUrl`, provider-specific `headers` or `providerOptions`).
4. Add contract tests — the same test suite shape used for OpenRouter (streaming, non-streaming, tool calling where supported, error normalization, usage normalization) run against this adapter, so behavior stays comparable across providers.
5. Document which `providerOptions` this adapter accepts and passes through, since these are provider-specific escape hatches that bypass the common interface.

None of this should require touching an HTTP controller or the orchestration service — if it does, the adapter boundary has leaked and needs to move back behind the interface.

## Model identity — don't blur these three

- **Public id**: what the client sees in `model` / `/v1/models`, e.g. `open-fusion/default`.
- **Internal id**: the config key under `models.*`, e.g. `worker.fast`.
- **Provider model id**: the real id sent to the provider, e.g. `openai/gpt-4.1-mini` or `anthropic/claude-...`.

The client must never need to know the internal id or provider model id. When adding a new provider, resist any shortcut that has a controller or route config reference a provider-native model string directly — it should always go through the `models.*` config entry.

## Capabilities

Declare capabilities on each model entry from the canonical set the gateway understands for orchestration/routing (`general`, `reasoning`, `coding`, `long_context`, `vision`, `tool_calling`, `json_mode`, `fast_draft`, `low_cost`, plus the routing-specific `plan`/`code`/`review`/`design`/`general` set used by `delegate_llm` — see `openfusion-routing-engine`). Capabilities are advisory metadata for the orchestrator; they do not substitute for the adapter's own "does this model actually support tool calling / streaming" checks. Don't let a model claim a capability the adapter can't actually back up.

## OpenRouter specifics (the reference implementation)

- Config fields: `apiKeyEnv`, `baseUrl` (default `https://openrouter.ai/api/v1`), `headers` (e.g. `HTTP-Referer`, `X-Title`), `providerOptions`.
- Use the Vercel AI SDK's OpenRouter provider rather than hand-rolling HTTP calls, per ADR 0003/0006.
- Not every model behind OpenRouter supports tools or streaming uniformly — the adapter must surface this per-model rather than assuming uniform capability across the whole provider.

## Adding a genuinely new provider (beyond OpenRouter)

Expect gaps the Vercel AI SDK doesn't paper over: differing tool-calling formats, missing usage metadata, different streaming event shapes, or providers with no native Vercel AI SDK integration (may need a community provider package or a thin custom wrapper). Normalize these differences inside the adapter — the rest of the gateway must not need to know which provider it's talking to.
