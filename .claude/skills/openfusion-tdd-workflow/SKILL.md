---
name: openfusion-tdd-workflow
description: Use for every code change in the Open Fusion gateway — new feature, bug fix, refactor, or spec implementation — to drive the work test-first (red-green-refactor) instead of writing implementation then backfilling tests. Triggers whenever the user asks to implement, fix, or change behavior in this NestJS project, says "TDD", "test-first", "write the test first", or hands you a spec/ADR to build. Pairs with openfusion-implement-spec (which tells you *what* the acceptance criteria are) — this skill tells you *how* to build toward them one red-green-refactor cycle at a time. Also pull in openfusion-solid-dry-design during the refactor step.
---

# Test-driven development on Open Fusion

Every spec under `docs/specs/` already lists acceptance criteria and, for the more complex ones, an explicit "Expected Tests" section. That's not incidental — this project was documented test-first, and the expectation is that you build it the same way: no implementation code that doesn't exist because a failing test demanded it.

## The loop

1. **Red** — write one test that fails because the behavior doesn't exist yet. Pick the smallest next slice of an acceptance criterion or "Expected Tests" bullet, not the whole feature at once. Run it and *confirm it fails for the reason you expect* (missing implementation, not a typo in the test) — a red step you didn't actually watch fail is not a red step.
2. **Green** — write the minimum code to pass that one test. Resist adding anything the current test doesn't require, even if you can see it coming later (that's what the next red step is for). Run the full affected test file, not just the new test, to make sure you didn't break a sibling case.
3. **Refactor** — with the safety net green, clean up duplication or awkward structure introduced by the last couple of cycles. This is where `openfusion-solid-dry-design` applies: fix responsibility leaks, extract shared logic, tighten interfaces. Re-run tests after every refactor edit, not just at the end of the refactor step.

Repeat until the spec's acceptance criteria and "Expected Tests" are all covered. Treat that list as the loop's exit condition, not a checklist to backfill afterward.

## Choosing what kind of test for what layer

The architecture is layered (HTTP → orchestration service → provider adapters → Vercel AI SDK, per ADR 0007/0001) and the test type should match the layer under test:

- **Unit tests** for a single class/service in isolation — provider adapters (mock the Vercel AI SDK call), the config validator (mock/fixture JSON files, valid and invalid), the orchestration service's classification/graph logic (fake orchestrator + fake delegate responses, no real network). Most of the "Expected Tests" bullets in specs 002/005/006 are this kind.
- **Integration tests** for module wiring — a route's config resolving to the right orchestrator/delegates through NestJS DI, without going over real HTTP or hitting a real provider.
- **E2E tests** for the public contract — `POST /v1/chat/completions` and `GET /v1/models` through the actual HTTP layer, checking the OpenAI-compatible envelope, SSE chunk shape, and `[DONE]` termination (see `openfusion-openai-contract` for what "correct" looks like at this layer). Spec 006 explicitly calls for an E2E test validating `delta.content` accumulation and `finish_reason`.

Write the unit tests first for whatever you're building — they're faster feedback and pin down the logic — then add the integration/e2e test that proves the layers compose correctly. Don't skip straight to an E2E test for something that has meaningful internal logic; a passing E2E test with no unit coverage tells you the happy path works but hides which internal branch is wrong when it doesn't.

## Test doubles for this codebase's specific hazards

- **Provider adapters**: fake the adapter behind its interface rather than mocking the Vercel AI SDK deep inside a real adapter — keeps orchestration tests from breaking every time a provider adapter's internals change, and keeps the adapter's own tests focused on adapter concerns (see `openfusion-provider-adapter`).
- **The orchestrator LLM call**: fake `generate()`/`stream()` responses deterministically (fixed text, fixed tool calls) so classification/graph/enforcement tests are not flaky non-deterministic-LLM tests. Real-model integration, if ever added, is a separate and much smaller test tier.
- **Config files**: use fixture JSON files (valid, and one invalid variant per validation rule) rather than constructing config objects inline in every test — keeps `openfusion-config-schema` validation tests readable and makes it obvious which fixture exercises which rule.
- **Secrets**: never let a real secret value flow into a test fixture or assertion — use fake `*Env` var names and fake values, and add a test that a secret never appears in a logged/serialized output (this is a testable, not just reviewable, requirement per spec 007).

## Writing the failing test itself

- Name tests after the behavior, not the implementation ("rejects delegation to a model outside allowedDelegateModels", not "test3" or "delegate_llm validation"). Anyone reading only test names should be able to reconstruct the spec's acceptance criteria.
- Cover the negative/failure paths as their own red-green cycles, not as an afterthought bolted onto the happy-path test — these specs treat failure handling as first-class (timeouts, blocked delegation, invalid graphs, provider errors), and TDD makes it natural to test them one at a time instead of trying to enumerate every failure mode in one giant test.
- When a bug is reported, the first action is a red test that reproduces it against current behavior — not a fix. If you can't write a failing test for the bug, you don't yet understand the bug.

## When TDD feels awkward here

Streaming (SSE) and parallel agent execution are the two places TDD can feel harder to apply directly. Don't skip the discipline — instead, test the underlying logic (chunk sequencing, graph scheduling) as plain synchronous unit tests against fakes, and reserve real streaming/concurrency behavior for a thinner layer of integration tests. If you find yourself wanting to skip straight to manual/E2E verification because "it's async," that's usually a sign the logic needs to be extracted into something more directly testable first.
