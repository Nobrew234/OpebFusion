import {
  generateText,
  jsonSchema,
  streamText,
  tool,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { ProviderConfig } from '../../config/config.interfaces';

/**
 * A narrow, 1:1 port over the exact Vercel AI SDK primitives the OpenRouter
 * adapter uses (ADR 0003 says the gateway USES the SDK; this seam keeps that
 * usage in one place). The real implementation below wires `ai` +
 * `@openrouter/ai-sdk-provider`; tests inject a fake so the adapter's message,
 * tool, usage and error normalization can be verified without a network call
 * (AGENTS.md: never call a real provider in tests).
 */
export interface SdkToolDefinition {
  description: string;
  /** JSON Schema for the tool arguments. */
  inputSchema: Record<string, unknown>;
}

export interface SdkModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: unknown;
}

export interface SdkGenerateOptions {
  model: unknown;
  messages: SdkModelMessage[];
  tools?: Record<string, SdkToolDefinition>;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  abortSignal?: AbortSignal;
}

export interface SdkToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface SdkUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface SdkGenerateResult {
  text: string;
  toolCalls?: SdkToolCall[];
  finishReason: string;
  usage?: SdkUsage;
}

export interface SdkStreamResult {
  textStream: AsyncIterable<string>;
  finishReason: Promise<string>;
  usage: Promise<SdkUsage>;
}

export interface OpenRouterSdk {
  /** Builds a provider-bound language model for a given provider model id. */
  createModel(provider: ProviderConfig, modelId: string): unknown;
  generate(options: SdkGenerateOptions): Promise<SdkGenerateResult>;
  stream(options: SdkGenerateOptions): SdkStreamResult;
}

export const OPENROUTER_SDK = Symbol('OPENROUTER_SDK');

const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Real Vercel AI SDK implementation of the OpenRouter port. This is the only
 * place in the gateway that imports `ai` / the OpenRouter provider — it is
 * intentionally NOT unit-tested against the network; the adapter that consumes
 * it is tested with a fake port.
 */
export class RealOpenRouterSdk implements OpenRouterSdk {
  createModel(provider: ProviderConfig, modelId: string): LanguageModel {
    const openrouter = createOpenRouter({
      apiKey: provider.apiKey ?? '',
      baseURL: provider.baseUrl ?? DEFAULT_OPENROUTER_BASE_URL,
      ...(provider.headers ? { headers: provider.headers } : {}),
    });
    return openrouter.chat(modelId);
  }

  async generate(options: SdkGenerateOptions): Promise<SdkGenerateResult> {
    const result = await generateText(this.toSdkOptions(options));
    return {
      text: result.text,
      toolCalls: result.toolCalls.map((call) => ({
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input as unknown,
      })),
      finishReason: result.finishReason,
      usage: {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
      },
    };
  }

  stream(options: SdkGenerateOptions): SdkStreamResult {
    const result = streamText(this.toSdkOptions(options));
    // The SDK exposes these as custom thenables; wrap in real Promises.
    return {
      textStream: result.textStream,
      finishReason: Promise.resolve(result.finishReason),
      usage: Promise.resolve(result.usage).then((usage) => ({
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
      })),
    };
  }

  private toSdkOptions(options: SdkGenerateOptions): {
    model: LanguageModel;
    messages: ModelMessage[];
    // AI SDK v7 rejects `system`-role messages inside `messages` unless this is
    // set (default false), demanding the top-level `instructions` option
    // instead. The orchestration engine composes system prompts inline, so we
    // opt back into inline system messages here — the one place bound to the
    // real SDK. OpenRouter chat models accept system messages natively.
    allowSystemInMessages: boolean;
    tools?: ToolSet;
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
    abortSignal?: AbortSignal;
  } {
    const tools = options.tools
      ? Object.fromEntries(
          Object.entries(options.tools).map(([name, def]) => [
            name,
            tool({
              description: def.description,
              inputSchema: jsonSchema(def.inputSchema),
            }),
          ]),
        )
      : undefined;

    return {
      model: options.model as LanguageModel,
      messages: options.messages as unknown as ModelMessage[],
      allowSystemInMessages: true,
      ...(tools ? { tools } : {}),
      ...(options.temperature !== undefined
        ? { temperature: options.temperature }
        : {}),
      ...(options.topP !== undefined ? { topP: options.topP } : {}),
      ...(options.maxOutputTokens !== undefined
        ? { maxOutputTokens: options.maxOutputTokens }
        : {}),
      ...(options.stopSequences !== undefined
        ? { stopSequences: options.stopSequences }
        : {}),
      ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
    };
  }
}
