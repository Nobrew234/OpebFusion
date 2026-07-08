---
name: openfusion-config-schema
description: Use when adding, changing, or validating fields in Open Fusion's single JSON configuration file (open-fusion.config.json) — providers, models, routes, auth/apiKeys, observability, or any new top-level section — or when working on the boot-time schema validation itself. Triggers on requests like "add a new field to the config", "add a config option for X", "the gateway should fail to boot if Y is missing", or "how do I add a new route/model/provider entry to the config schema". Not for adding a new provider adapter's runtime logic (use openfusion-provider-adapter) or routing behavior (use openfusion-routing-engine) — this skill is specifically about the config file's shape and validation.
---

# Changing Open Fusion's JSON configuration schema

Per ADR 0004 and spec 003, all operational configuration (providers, models, routes, auth, limits, observability) lives in one JSON file read once at boot. There is no dynamic reload in the MVP — every schema change is a boot-time contract.

## Ground rules (spec 003)

- The config path comes from `OPEN_FUSION_CONFIG`, falling back to `./config/open-fusion.config.json`.
- **Validate the whole schema before the HTTP server starts.** A config error must produce a clear boot failure that names the invalid field's path — never a silent partial start or a runtime crash on first request.
- Any field holding a secret must be a `*Env` reference (e.g. `apiKeyEnv`, `tokenEnv`), never the literal secret value. The resolved value must never be serialized into logs, error messages, or responses.
- `version` at the config root gates schema compatibility — bumping the schema in a breaking way means bumping `version` and handling/rejecting older versions explicitly, not silently reinterpreting old files under a new shape.

## When adding a new field

1. **Decide where it belongs** in the existing structure (`server`, `auth`, `providers.<name>`, `models.<key>`, `routes.<key>`, `observability`) or whether it's a genuinely new top-level section. Fields on a config entry should stay adjacent to the concept they configure — e.g. a new per-route limit goes in `routes.<key>`, not in `server`.
2. **Add the validation, not just the type.** Every new field needs an explicit validity rule, not just "accept whatever shape comes in": required vs optional, integer positivity for limits, enum membership for anything with a fixed vocabulary (provider `type`, model `role`, capability strings), and cross-references to other parts of the config (e.g. a route's `orchestrator` must resolve to an existing `models.*` entry with `role: "orchestrator"`; `allowedDelegateModels` entries must exist and have `role: "delegate"`).
3. **Write the boot-failure test alongside the happy-path test.** Spec 003's acceptance criteria explicitly require the app to fail boot with a clear error on an invalid file — a new field without a corresponding "missing/invalid → boot fails with a field-path-naming error" test is incomplete.
4. **Update the example config** in spec 003 / any sample config file in the repo so it stays a working reference, not documentation drift.
5. **If the field is a secret**, follow the `*Env` convention exactly — name it `<thing>Env`, resolve it from `process.env` at boot, validate the env var exists (unless a documented permissive local-dev mode allows missing secrets), and audit that nothing downstream logs the resolved value.

## Cross-referential validations already required (don't regress these when refactoring)

- Every provider needs a known `type`.
- Every model references an existing provider.
- Every route references an existing orchestrator model.
- `allowedDelegateModels` on a route contains only models that exist and have `role: "delegate"`.
- `maxDepth` must be `1` in the MVP — this is a hard architectural ceiling (single level of delegation, no recursive orchestration), not a default that happens to be 1 today. Don't let a schema change quietly allow depth > 1.
- Payload/message-count/message-length limits, when present, must be positive integers.
- For routes with routed streaming (spec 006), at least one allowed delegate must declare the `general` capability — this is a config-time validation now, not just a runtime routing concern (see `openfusion-routing-engine`), so it belongs in this schema's validation too.

## Evolution path

Spec 003 explicitly defers dynamic reload, DB-backed config, per-tenant overrides, route templates, and partial-file imports to later versions — don't build these speculatively into the schema now. If a request pushes toward one of these, flag it as a scope decision rather than quietly expanding the MVP schema.
