import { Inject, Injectable } from '@nestjs/common';
import { ModelConfig, ProviderConfig } from '../../config/config.interfaces';
import { GatewayApiException } from '../../common/errors/gateway-api.exception';
import {
  InvocationFinishReason,
  InvocationMessage,
  InvocationUsage,
  ModelInvocationRequest,
  ModelInvocationResult,
  ModelStreamChunk,
  ModelToolCall,
  ToolSpec,
} from '../model-invoker.interfaces';
import { ProviderAdapter } from '../provider-adapter.interfaces';
import { OPENROUTER_SDK } from './openrouter-sdk';
import type {
  OpenRouterSdk,
  SdkGenerateOptions,
  SdkModelMessage,
  SdkStreamResult,
  SdkToolDefinition,
  SdkUsage,
} from './openrouter-sdk';

/**
 * OpenRouter provider adapter (spec 004, ADR 0006), the reference adapter.
 * Everything OpenRouter/SDK-specific — building the language model, mapping our
 * neutral messages/tools to SDK shapes, and normalizing the SDK's result,
 * usage and errors — stays inside this boundary. Nothing above it (the
 * orchestration engine, controllers) learns which provider answered.
 */
@Injectable()
export class OpenRouterAdapter implements ProviderAdapter {
  readonly type = 'openrouter';

  constructor(@Inject(OPENROUTER_SDK) private readonly sdk: OpenRouterSdk) {}

  async invoke(
    model: ModelConfig,
    provider: ProviderConfig,
    request: ModelInvocationRequest,
  ): Promise<ModelInvocationResult> {
    const options = this.buildOptions(model, provider, request);
    try {
      const result = await this.sdk.generate(options);
      return {
        content: result.text ?? '',
        toolCalls: this.mapToolCalls(result.toolCalls),
        finishReason: this.mapFinishReason(result.finishReason),
        usage: this.mapUsage(result.usage),
      };
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async *stream(
    model: ModelConfig,
    provider: ProviderConfig,
    request: ModelInvocationRequest,
  ): AsyncIterable<ModelStreamChunk> {
    const options = this.buildOptions(model, provider, request);
    let result: SdkStreamResult;
    try {
      result = this.sdk.stream(options);
    } catch (error) {
      // Failure before the first chunk: surface a normalized HTTP error.
      throw this.normalizeError(error);
    }

    try {
      for await (const delta of result.textStream) {
        if (delta.length > 0) {
          yield { delta, finishReason: null };
        }
      }
    } catch (error) {
      // Failure after streaming started: normalize and rethrow. The caller
      // (controller) closes the SSE stream cleanly without leaking detail.
      throw this.normalizeError(error);
    }

    const [finishReason, usage] = await Promise.all([
      result.finishReason,
      result.usage,
    ]);
    yield {
      delta: '',
      finishReason: this.mapFinishReason(finishReason),
      usage: this.mapUsage(usage),
    };
  }

  private buildOptions(
    model: ModelConfig,
    provider: ProviderConfig,
    request: ModelInvocationRequest,
  ): SdkGenerateOptions {
    return {
      model: this.sdk.createModel(provider, model.model),
      messages: request.messages.map((message) => this.toSdkMessage(message)),
      ...(request.tools && request.tools.length > 0
        ? { tools: this.toSdkTools(request.tools) }
        : {}),
      ...(request.temperature !== undefined
        ? { temperature: request.temperature }
        : {}),
      ...(request.topP !== undefined ? { topP: request.topP } : {}),
      ...(request.maxTokens !== undefined
        ? { maxOutputTokens: request.maxTokens }
        : {}),
      ...(request.stop !== undefined
        ? { stopSequences: this.toStopSequences(request.stop) }
        : {}),
      ...(request.timeoutMs !== undefined
        ? { abortSignal: AbortSignal.timeout(request.timeoutMs) }
        : {}),
    };
  }

  private toSdkMessage(message: InvocationMessage): SdkModelMessage {
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const parts: unknown[] = [];
      if (message.content) {
        parts.push({ type: 'text', text: message.content });
      }
      for (const call of message.toolCalls) {
        parts.push({
          type: 'tool-call',
          toolCallId: call.id,
          toolName: call.name,
          input: call.arguments,
        });
      }
      return { role: 'assistant', content: parts };
    }
    if (message.role === 'tool') {
      return {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: message.toolCallId ?? '',
            toolName: message.name ?? '',
            output: { type: 'text', value: message.content },
          },
        ],
      };
    }
    return { role: message.role, content: message.content };
  }

  private toSdkTools(tools: ToolSpec[]): Record<string, SdkToolDefinition> {
    return Object.fromEntries(
      tools.map((spec) => [
        spec.name,
        { description: spec.description, inputSchema: spec.parameters },
      ]),
    );
  }

  private toStopSequences(stop: string | string[]): string[] {
    return Array.isArray(stop) ? stop : [stop];
  }

  private mapToolCalls(
    toolCalls: Array<{
      toolCallId: string;
      toolName: string;
      input: unknown;
    }> = [],
  ): ModelToolCall[] {
    return toolCalls.map((call) => ({
      id: call.toolCallId,
      name: call.toolName,
      arguments: this.asRecord(call.input),
    }));
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private mapFinishReason(reason: string): InvocationFinishReason {
    switch (reason) {
      case 'length':
        return 'length';
      case 'tool-calls':
        return 'tool_calls';
      case 'content-filter':
        return 'content_filter';
      default:
        return 'stop';
    }
  }

  private mapUsage(usage: SdkUsage | undefined): InvocationUsage {
    const promptTokens = usage?.inputTokens ?? 0;
    const completionTokens = usage?.outputTokens ?? 0;
    return {
      promptTokens,
      completionTokens,
      totalTokens: usage?.totalTokens ?? promptTokens + completionTokens,
    };
  }

  /**
   * Maps a provider/SDK error to the gateway's normalized error envelope
   * without ever leaking the raw provider message, stack, or a secret. Uses
   * only the HTTP status code and error kind to choose a safe category.
   */
  private normalizeError(error: unknown): GatewayApiException {
    if (error instanceof GatewayApiException) {
      return error;
    }

    const name = this.readString(error, 'name');
    if (name === 'AbortError' || name === 'TimeoutError') {
      return GatewayApiException.timeout();
    }

    const statusCode = this.readNumber(error, 'statusCode');
    if (statusCode === 429) {
      return GatewayApiException.rateLimited();
    }
    if (statusCode === 408) {
      return GatewayApiException.timeout();
    }
    if (statusCode !== undefined && statusCode >= 500) {
      return GatewayApiException.providerUnavailable();
    }
    return GatewayApiException.providerError();
  }

  private readString(error: unknown, key: string): string | undefined {
    const value = this.readProp(error, key);
    return typeof value === 'string' ? value : undefined;
  }

  private readNumber(error: unknown, key: string): number | undefined {
    const value = this.readProp(error, key);
    return typeof value === 'number' ? value : undefined;
  }

  private readProp(error: unknown, key: string): unknown {
    if (error && typeof error === 'object' && key in error) {
      return (error as Record<string, unknown>)[key];
    }
    return undefined;
  }
}
