---
name: openfusion-solid-dry-design
description: Use when designing new classes/modules/interfaces in the Open Fusion gateway, or when refactoring existing code (especially the refactor step of TDD, see openfusion-tdd-workflow) — to keep the design aligned with SOLID and DRY as applied to this project's NestJS + provider-adapter + orchestration architecture. Triggers on requests like "review this design", "refactor this service", "is this a good abstraction", "add a new provider/capability without breaking existing ones", or any point where you're about to introduce a new class, interface, or shared helper. Complements the general-purpose /code-review and /simplify skills — this one is specifically about applying named design principles to this codebase's architecture, not a general correctness or line-level cleanup pass.
---

# SOLID and DRY on Open Fusion

This project's architecture (NestJS modules, provider adapters behind a common interface, an orchestration service that must support new capabilities and providers without rewrites) is already SOLID-shaped by the ADRs — ADR 0007's whole point is Open/Closed and Dependency Inversion. The job here is to keep new code honoring that shape rather than eroding it one convenient shortcut at a time.

## Single Responsibility — one reason to change per class

Each of these should have exactly one reason to change; if you find yourself editing one because of a change in a different concern, that's the design telling you something has merged:

- A **provider adapter** changes only when that provider's API/SDK integration changes — never because of a routing rule or a config-shape change.
- The **orchestration/routing logic** (classification, graph validation, enforcement — see `openfusion-routing-engine`) changes only because routing/delegation policy changed — never because a provider's response format changed (that's the adapter's job to normalize away).
- **Controllers/DTOs** change only because the public HTTP contract changed (see `openfusion-openai-contract`) — they should never contain provider-specific or orchestration-specific logic.
- The **config validator** changes only because the config schema changed.

When writing a new class, ask what would make you edit it next month. If the honest answer is "two unrelated things," split it before it's used anywhere.

## Open/Closed — extend without rewriting

New providers (`openfusion-provider-adapter`), new delegate capabilities, and new routes must all be addable by *adding* a new adapter/config entry/strategy, not by adding `if (providerType === 'newone')` branches inside the orchestration service or a shared "generic provider" god-class. If adding a provider requires touching code outside the new adapter file, its config registration, and its own tests, the abstraction has a gap — flag it rather than pushing the branch in anyway.

This also cuts the other way: don't build speculative extension points for providers or capabilities nobody has asked for yet (that's YAGNI, and this project's specs are explicit about deferring things like dynamic config reload and multi-tenant overrides). Open/Closed is about not breaking existing callers when a *real* new case shows up, not about pre-building hooks for imagined ones.

## Liskov Substitution — every adapter is truly interchangeable

Any code holding a reference to "a provider adapter" or "a delegate model" must work correctly no matter which concrete provider/model is behind it. Concretely: if the OpenRouter adapter throws a raw SDK error on rate-limit but a hypothetical Anthropic adapter would need to throw the gateway's normalized error type, that's a Liskov violation waiting to surface as an inconsistent error envelope in production. Contract tests (spec 004, `openfusion-provider-adapter`) exist specifically to catch this — every new adapter must pass the same contract test suite as OpenRouter, not a bespoke subset.

## Interface Segregation — don't force a fat interface on every adapter

The provider adapter interface should expose only what every provider adapter must implement (model construction, generate, stream, error normalization, usage normalization) — capability-specific behavior (tool calling, JSON mode) should be optional/queryable ("does this adapter support tools?") rather than a required method every adapter must stub out with a "not supported" throw. A fat interface that most adapters partially fake is a design smell, not a convenience.

## Dependency Inversion — depend on abstractions, wire concretes via NestJS DI

The orchestration service depends on a provider-adapter *interface* (injected via a NestJS provider token), never on a concrete `OpenRouterAdapter` import. Controllers depend on the orchestration service's interface, never on provider SDKs or the Vercel AI SDK directly (this is ADR 0007's explicit rule, and it's also what makes the adapter swappable in tests via `openfusion-tdd-workflow`'s fakes). If a new piece of code needs a concrete class type-hinted or imported directly to work, check whether it should be depending on the interface/token instead.

## DRY — don't repeat yourself, but repeat coincidence freely

Duplication worth removing is duplication of a *single concept* that would need to change in lockstep everywhere it appears — e.g., the OpenAI error-envelope shape (`openfusion-openai-contract`), the secret-redaction logic (spec 007), or the capability-priority ordering (`openfusion-routing-engine`) should each exist in exactly one place. If you're writing the same `plan > review > design > ...` priority list, the same redaction key list, or the same envelope-building code a second time, extract it.

Duplication that merely *looks* similar but represents unrelated concepts that happen to change independently is not a DRY violation — don't merge two provider adapters' near-identical-looking error mapping into one shared function just because they're similar today, if each provider's error taxonomy is likely to diverge. Premature deduplication across things that aren't conceptually the same thing creates exactly the kind of coupling SRP and Open/Closed are trying to avoid. When in doubt, tolerate the duplication until a third occurrence proves the pattern, per the usual "rule of three."

## Quick check before finishing a refactor

Ask, concretely, about the class/module you just touched: what's its one reason to change; could a new provider or capability be added without editing it; would swapping its dependency for a test fake require changing its own code; is there a concept (error shape, redaction list, priority order) now defined in more than one place. Any "yes" that shouldn't be there is worth fixing before calling the refactor step done.
