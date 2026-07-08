---
name: openfusion-openai-contract
description: Use whenever code touches Open Fusion's public HTTP surface — POST /v1/chat/completions, GET /v1/models, authentication, request validation, error responses, or SSE streaming — to check or enforce conformance with the OpenAI Chat Completions contract. Triggers on requests like "does this response match the OpenAI format", "review the error handling for spec 001", "check the streaming chunks are OpenAI-compatible", "an OpenAI SDK client is failing against the gateway", or any diff that changes response shape, status codes, or SSE chunk fields. This is a conformance checklist, usable during implementation or as a standalone review pass — pair with openfusion-implement-spec for full feature work.
---

# Open Fusion's OpenAI-compatible contract

The entire value proposition (ADR 0002) is that an existing OpenAI SDK client works against this gateway by only changing `baseURL` and the token. Any deviation in response shape, error shape, or streaming format breaks that promise for every client, not just the one you're testing against — treat this contract as stricter than most internal APIs, because you don't control the client code that parses it.

## `POST /v1/chat/completions` — non-streaming response

Required envelope shape (spec 001):

```json
{
  "id": "chatcmpl_<id>",
  "object": "chat.completion",
  "created": 1710000000,
  "model": "route/default",
  "choices": [{ "index": 0, "message": { "role": "assistant", "content": "..." }, "finish_reason": "stop" }],
  "usage": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 }
}
```

- `usage` may be omitted or filled per policy when the provider doesn't report it — but if present, it must be the gateway's aggregated usage across orchestrator + delegations + final synthesis (spec 005 Fase 6), not just the final call's usage.
- `model` in the response is the public route/model id the client asked for — never an internal config key or a raw provider model id (see the id-identity distinction in `openfusion-provider-adapter`).

## `finish_reason` mapping (spec 005) — don't invent new values

- `stop` — natural completion.
- `length` — token limit reached.
- `tool_calls` — model requests tools *in the final response* (not an internal delegation tool call — those never surface here).
- `content_filter` — provider signaled a content block.
- Internal `error` states get converted to an HTTP error (non-streaming) or a controlled stream closure (streaming) — `error` is not itself a client-visible `finish_reason`.

## `GET /v1/models`

Each entry: `id` (public id), `object: "model"`, `created` (Unix timestamp when known), `owned_by` (default `open-fusion` or configured value). List only publicly routable models/routes — never internal delegate or orchestrator config keys.

## Auth

`Authorization: Bearer <gateway-api-key>` authenticates the *gateway's own client*, never the upstream provider. This token must never be forwarded to a provider, logged, or echoed in any response or error. Provider credentials are resolved server-side from config only (see `openfusion-config-schema`'s `*Env` convention).

## Errors — envelope and status mapping

```json
{ "error": { "message": "human-readable", "type": "invalid_request_error", "param": "model", "code": "model_not_found" } }
```

Minimum status mapping (spec 001): `400` invalid request, `401` missing/invalid token, `403` client lacks permission for model/route, `404` unknown public model, `408` timeout, `429` rate limit, `500` internal error, `502` provider error, `503` provider unavailable. When normalizing a provider-adapter error (see `openfusion-provider-adapter`) into this envelope, never let the provider's raw error message, stack trace, or credential details leak into `message`.

## Streaming (SSE)

- Content type `text/event-stream`; each event is `data: <chat.completion.chunk JSON>`.
- Only open the stream after request + route + auth validation succeed — a validation failure must never leave a half-open stream; it must be a normal HTTP error response instead (spec 001, spec 005 Fase 7, spec 006 Phase 5).
- Every chunk keeps `id`, `object`, `created`, `model`, `choices[].delta`, and `finish_reason` internally consistent across the whole stream (same `id`/`model`, `finish_reason: null` until the terminal chunk).
- Only the final target's `delta.content` is ever emitted — no delegation events, tool-call chunks, internal prompts, or execution-graph metadata (see `openfusion-routing-engine` for why this matters beyond just the HTTP contract).
- Terminal chunk carries the final `finish_reason` with `delta: {}`, followed by a literal `data: [DONE]` line.
- A failure **after** streaming has started must close the stream in a controlled way (no stack trace, no secrets, no internal trace) rather than emitting a malformed chunk or hanging the connection.

## Tools

Two categories exist and must never blur together in the public contract: client-supplied `tools`/`tool_choice` (only honored when the active route explicitly allows external tools) and the internal `delegate_llm` tool (never listed, never selectable, never visible to the client in any form — see `openfusion-routing-engine`).

## Quick conformance pass for a diff

When reviewing a change to this surface, check: (1) does a stock OpenAI SDK client's response parser still work unmodified against this shape, (2) do all error paths map to the table above rather than a generic 500, (3) is every non-`stop` `finish_reason` reachable and correctly triggered, (4) does the stream always terminate with `[DONE]` even on internal failure, (5) is there any field, header, or error message that could leak a secret, an internal model id, or an orchestration detail.
