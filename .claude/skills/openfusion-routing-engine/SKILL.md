---
name: openfusion-routing-engine
description: Use for anything touching Open Fusion's LLM-orchestrated routing and delegation engine — the orchestrator model, the internal delegate_llm tool, capability classification (plan/code/review/design/general), the execution graph, parallel agent execution, or orchestrator_fallback. Triggers on requests like "implement the orchestrator", "add capability classification", "the delegate_llm tool isn't enforcing allowed models", "make routed streaming run agents in parallel", or any bug/feature touching OrchestrationService, streamFinal(), or how a request picks which model actually answers. This is the most failure-prone subsystem in the gateway (specs 002/005/006) — pull this in even for changes that look like small tweaks to it.
---

# Open Fusion's orchestration/routing engine

This is the core, most intricate mechanism in the gateway (ADR 0005, specs 002, 005, 006): an LLM "orchestrator" decides whether to answer directly or delegate subtasks to other configured models via an internal `delegate_llm` tool — but the backend, not the orchestrator's goodwill, is the actual authority over what gets called and what streams to the client.

## The one idea that governs everything here

**The orchestrator proposes; the backend disposes.** Every design decision in specs 002/005/006 exists because an LLM orchestrator can answer directly when it shouldn't, pick an unauthorized or wrong-capability model, skip useful parallelism, or omit delegation entirely. None of that is a bug in the orchestrator prompt to be patched with better wording — it's the reason the backend must deterministically validate, correct, or override every orchestrator decision before anything reaches a provider call or the client. If you're implementing a fix by improving the orchestrator's system prompt instead of adding backend enforcement, you're solving the wrong layer.

## Canonical capabilities (spec 006) — closed set, don't extend casually

| Capability | Use |
|---|---|
| `plan` | Planning, architecture, decomposition, roadmaps, implementation strategy |
| `code` | Implementation, debugging, scripts, refactors, executable code |
| `review` | Critical review, audit, quality/security/correctness analysis |
| `design` | UX/UI, IA, interaction flows, design systems, wireframes |
| `general` | Anything that doesn't clearly fit the above |

Priority when a request could plausibly match more than one: **`code` > `review` > `design` > `plan` > `general`.**

Capabilities outside this set (e.g. `reasoning`, `long_context`, `vision` from spec 004's provider-capability list) are advisory metadata for model selection quality, not part of this mandatory routing enforcement.

## `general` vs `orchestrator_fallback` — the distinction people get wrong

- **`general`** is a normal delegate capability. A request classified `general` must go to an allowed delegate declaring `general` — even if the orchestrator tried to answer directly.
- **`orchestrator_fallback`** is a separate, explicit final-target path: same model as the route's configured orchestrator, used *only* when the classified capability is specialized (`plan`/`code`/`review`/`design`) and no allowed delegate has that exact capability.
- The orchestrator model **never** counts as satisfying the `general` requirement, no matter how capable it is.
- A route with routed streaming and no allowed `general` delegate is **invalid configuration** — reject it before opening SSE (and ideally at config-validation time; see `openfusion-config-schema`).

If you write code where a missing specialized delegate and a missing `general` delegate are handled the same way, that's a bug — they have different resolutions (fallback vs. hard failure).

## The mandatory pipeline (spec 006, Stages 1–5 / Phases 1–6)

1. **Classification** (before opening SSE): classify the request into exactly one of the five capabilities using deterministic heuristics over `messages`, route metadata, and optionally an orchestrator hint when heuristics are ambiguous. Persist the capability, the method (`heuristic` / `orchestrator_hint` / `default_general`), and confidence if available — this is required for observability (spec 005 Fase 8 / spec 006 Phase 6), not optional telemetry.
2. **Candidate/target resolution**: filter `allowedDelegateModels` to those declaring the classified capability. Zero candidates + `general` → invalid route, fail before SSE. Zero candidates + specialized → `orchestrator_fallback`. One candidate → use it. Multiple candidates with the same capability → prefer `allowedDelegateModels` order; only let the orchestrator break a genuine tie among *valid* candidates, and reject/correct any orchestrator choice outside that set.
3. **Orchestrator planning**: call the orchestrator with `generate()` (not `stream()` — planning is never what streams to the client) to allow tool calls and task refinement. Normalize its output into an execution graph: zero-or-more pre-final agent tasks, explicit dependencies, exactly one final target.
4. **Graph validation and enforcement, before any provider call for pre-final tasks**: reject cycles, unresolved dependencies, unauthorized models, more than one final target, recursive orchestration (`maxDepth` stays `1`), or anything exceeding route limits. Correct wrong-capability `target_model` choices to a valid candidate, or force `orchestrator_fallback` when none exists. If the orchestrator returned bare text with no valid final target, **discard that text** — it is never eligible to become the response.
5. **Parallel pre-final execution**: run independent agent tasks (no dependency path between them) concurrently; serialize tasks that consume another task's output. This is opportunistic and invisible to the client — never lets any information leak into the public stream before the final target starts. `maxDelegations` counts *every* delegated task attempt, including ones the backend forced, blocked, or corrected — not just ones the orchestrator "successfully" requested.
6. **Final streaming**: open SSE only after validation + graph enforcement + required pre-final tasks have completed successfully. Call `stream()` on the delegate (delegated target) or on the route orchestrator (`orchestrator_fallback`) — never on anything else. Emit only `delta.content` from this one final target; end with `data: [DONE]`.

## Things that are easy to get subtly wrong

- **Treating parallel agent results as trusted.** They're untrusted content, same as any single delegation result (spec 002) — they inform the final target's context but can't override system instructions, policy, or limits.
- **Letting `delegate_llm` be called by the client directly, or exposed as a chooseable tool in the public contract.** It exists only inside the orchestrator's internal tool context (spec 005 Fase 2).
- **Streaming intermediate/delegated output to the client.** `streamFinalOnly` means literally only the final target's tokens reach the SSE stream — no delegation traces, no execution graph details, no tool-call chunks.
- **Conflating "no candidate for `general`" with "no candidate for a specialized capability."** They resolve differently (hard failure vs. `orchestrator_fallback`) — see above.
- **Forgetting that failures split by stream state.** Before the first chunk → OpenAI-compatible HTTP error. After streaming starts → controlled closure, log internally, never leak internals into the stream itself.
- **Assuming `maxDepth: 1` is a config default rather than an invariant.** Parallel agent tasks and delegates cannot spawn their own orchestration or further delegation in the MVP, full stop.

## Testing (spec 006's own "Expected Tests" list is close to exhaustive)

At minimum, cover: classification for each of the five capabilities; enforcement per capability when an exact delegate exists; explicit `orchestrator_fallback` when it doesn't; rejection of routes missing a `general` delegate; correction of a wrong-capability orchestrator choice; independent-task parallelism; dependent-task serialization; `maxDelegations` counting corrected/blocked/forced tasks; rejection of cyclic/multi-final-target graphs; blocked delegation to unauthorized models; absence of internal details in SSE chunks; failure before vs. after stream start.
