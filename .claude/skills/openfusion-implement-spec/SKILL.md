---
name: openfusion-implement-spec
description: Workflow for implementing any Open Fusion gateway feature that traces back to a spec/ADR under docs/specs or docs/adrs (chat completions endpoint, models endpoint, config loading, auth, logging, health checks, resilience limits, etc). Use this whenever the user asks to build, extend, or fix something in this NestJS LLM-gateway project, references a spec number ("spec 001", "spec 007"), or describes work that clearly belongs to Open Fusion's MVP scope even without naming a spec. For the routing/orchestration engine (specs 002/005/006) also pull in openfusion-routing-engine; for a new provider also pull in openfusion-provider-adapter; for config file shape changes also pull in openfusion-config-schema; for anything touching the public HTTP contract also pull in openfusion-openai-contract.
---

# Implementing an Open Fusion spec

Open Fusion is an OpenAI-compatible LLM gateway (NestJS + Vercel AI SDK, OpenRouter as first provider, single JSON config, LLM-orchestrated routing). The docs at `docs/PRD.md`, `docs/adrs/000N-*.md`, and `docs/specs/00N-*.md` are the source of truth — they were written before any code exists, so treat them as the spec to satisfy, not as background color.

## Before writing code

1. **Read the spec fully**, plus every ADR it links under "ADRs relacionados" / "Related ADRs". Specs reference each other's decisions instead of repeating them — skipping the linked ADR is how you end up violating a constraint decided elsewhere (e.g. spec 005 assumes ADR 0007's adapter isolation).
2. **Check for an `Implementation Order` or numbered rollout section** (spec 006 has one). If present, follow that sequence — later steps assume earlier ones exist (e.g. classification before graph validation before parallel execution).
3. **Extract the acceptance criteria and "Expected Tests" section verbatim** into your task list. These specs were written test-first; a spec without a matching test for each acceptance bullet is not done.
4. **Identify which invariants from other specs your change must not break**, even if your spec doesn't restate them. The ones that recur across nearly every spec and are easy to accidentally violate:
   - Controllers never import provider SDKs or the Vercel AI SDK directly — only provider adapters do (ADR 0007, spec 004).
   - Client-supplied tokens/tools never reach providers unmodified; provider credentials only ever come from server-side config (spec 001, spec 007).
   - Secrets (`*Env`-resolved values, API keys, bearer tokens) never appear in logs, error bodies, or responses (spec 003, spec 007).
   - `delegate_llm` and any other internal tool is invisible to the client — never listed in `/v1/models`-adjacent tool-choice surfaces (spec 002, spec 005).
   - Content coming back from a delegated/internal model call is untrusted: it cannot override system instructions, route policy, or execution limits (spec 002, spec 005, spec 006).
   - Failures before the first byte/chunk of a response → OpenAI-compatible HTTP error. Failures after streaming has started → controlled stream closure, no stack traces or internal detail (spec 001, spec 005).

## While implementing

- Keep the module boundaries NestJS-native: HTTP layer (controllers/DTOs) → orchestration service → provider adapters → Vercel AI SDK. Data should flow in that direction; nothing downstream should reach back up (e.g. an adapter should not know about routes).
- Match the spec's own phase/stage vocabulary in code and commit messages when one exists (spec 005's "Fase 1..8", spec 006's "Stage 1..5"). It keeps traceability between doc and implementation obvious for the next person (or agent) who reads both.
- Every configurable limit mentioned in a spec (`maxDelegations`, `maxDepth`, `timeoutMs`, `delegateTimeoutMs`, payload/message size limits) must be read from config, not hardcoded — cross-check against `openfusion-config-schema` if the field doesn't already exist there.
- If the feature touches `/v1/chat/completions` or `/v1/models` request/response shape in any way, run the checklist in `openfusion-openai-contract` before considering it done — small deviations there break every OpenAI-SDK client, not just this feature.

## Testing

- Write the unit/integration/E2E tests listed in the spec's own "Expected Tests" or "Criterios de aceite" section first if you can — they double as a definition of done.
- Cover the negative paths explicitly called out (blocked delegation, unauthorized model, invalid config, timeout before first chunk, failure mid-stream) — these specs consistently treat failure handling as first-class, not an afterthought.
- After implementing, re-read the acceptance criteria one more time and check each one off against actual test names/assertions, not against your memory of what you wrote.

## When a spec is ambiguous or the docs conflict with a clean implementation

Don't silently pick an interpretation. Specs here are marked `Draft` or `Implemented` — a `Draft` spec may still be wrong or incomplete. Flag the ambiguity to the user with the specific spec section and the two readings, rather than guessing and building on the wrong one.
