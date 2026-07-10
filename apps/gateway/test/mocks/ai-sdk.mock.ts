/**
 * Jest stub for the Vercel AI SDK (`ai`) and the OpenRouter provider
 * (`@openrouter/ai-sdk-provider`). Those packages are ESM-only and would fail
 * to load under ts-jest's CommonJS runtime; more importantly, no test may make
 * a real provider call (AGENTS.md). Every test that touches the provider layer
 * injects a fake `OpenRouterSdk` port instead, so these stubs exist only to
 * satisfy the static import in `openrouter-sdk.ts` (the real implementation) —
 * they are never expected to actually run. Both module specifiers are mapped
 * here via `moduleNameMapper`; unused exports are harmless.
 */
const notFaked = (name: string) => () => {
  throw new Error(
    `${name} was called in a test — the OPENROUTER_SDK port must be faked instead of hitting the real Vercel AI SDK.`,
  );
};

export const generateText = notFaked('ai.generateText');
export const streamText = notFaked('ai.streamText');
export const tool = <T>(definition: T): T => definition;
export const jsonSchema = <T>(schema: T): T => schema;
export const createOpenRouter = () => ({
  chat: (id: string) => ({ id }),
});
