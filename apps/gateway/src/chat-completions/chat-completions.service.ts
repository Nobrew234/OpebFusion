import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CONFIG_SERVICE } from '../config/config.interfaces';
import type {
  ApiKeyConfig,
  ConfigService,
  RouteConfig,
} from '../config/config.interfaces';
import { ORCHESTRATION_SERVICE } from '../orchestration/orchestration.interfaces';
import type {
  OrchestrationChunk,
  OrchestrationRequest,
  OrchestrationResult,
  OrchestrationService,
} from '../orchestration/orchestration.interfaces';
import { GatewayApiException } from '../common/errors/gateway-api.exception';
import { DELEGATE_LLM_TOOL_NAME } from '../orchestration/delegate-llm.tool';
import type { RequestLogContext } from '../common/logging/request-context';
import type { ToolSpec } from '../providers/model-invoker.interfaces';
import { ChatCompletionRequestDto } from './dto/chat-completion-request.dto';

export interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatCompletionChoice {
  index: 0;
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: OpenAiToolCall[];
  };
  finish_reason: OrchestrationResult['finishReason'];
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: [ChatCompletionChoice];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface StreamPreparation {
  id: string;
  created: number;
  model: string;
  chunks: AsyncIterable<OrchestrationChunk>;
}

@Injectable()
export class ChatCompletionsService {
  constructor(
    @Inject(CONFIG_SERVICE) private readonly configService: ConfigService,
    @Inject(ORCHESTRATION_SERVICE)
    private readonly orchestrationService: OrchestrationService,
  ) {}

  async createCompletion(
    dto: ChatCompletionRequestDto,
    apiKey: ApiKeyConfig,
    logContext?: RequestLogContext,
  ): Promise<ChatCompletionResponse> {
    const route = this.resolveRoute(dto, apiKey);
    this.enforceRouteLimits(dto, route);
    const result = await this.orchestrationService.generate(
      this.toOrchestrationRequest(dto, route),
    );
    this.stampResolvedModel(
      logContext,
      result.resolvedModel,
      result.delegatedModels,
    );
    return this.buildEnvelope(dto.model, result);
  }

  /**
   * Runs all validation/route/authorization checks eagerly (synchronously,
   * before any SSE bytes are written) and returns the fixed id/created/model
   * plus the lazy chunk iterable. The controller must call this BEFORE
   * setting any streaming response headers, per AGENTS.md: failures before
   * the first chunk must surface as a normal HTTP error, never a half-open
   * stream.
   */
  prepareStream(
    dto: ChatCompletionRequestDto,
    apiKey: ApiKeyConfig,
    logContext?: RequestLogContext,
  ): StreamPreparation {
    const route = this.resolveRoute(dto, apiKey);
    this.enforceRouteLimits(dto, route);
    const chunks = this.orchestrationService.stream(
      this.toOrchestrationRequest(dto, route),
    );
    return {
      id: this.generateId(),
      created: this.now(),
      model: dto.model,
      // The resolved model is only known once orchestration runs, which happens
      // lazily as the controller drains this iterable — so we stamp it as the
      // terminal chunk (which carries it) passes through.
      chunks: logContext ? this.stampFromStream(chunks, logContext) : chunks,
    };
  }

  private async *stampFromStream(
    chunks: AsyncIterable<OrchestrationChunk>,
    logContext: RequestLogContext,
  ): AsyncIterable<OrchestrationChunk> {
    for await (const chunk of chunks) {
      if (chunk.resolvedModel) {
        this.stampResolvedModel(
          logContext,
          chunk.resolvedModel,
          chunk.delegatedModels,
        );
      }
      yield chunk;
    }
  }

  private stampResolvedModel(
    logContext: RequestLogContext | undefined,
    resolvedModel: string | undefined,
    delegatedModels: string[] | undefined,
  ): void {
    if (!logContext || !resolvedModel) {
      return;
    }
    logContext.resolvedModel = resolvedModel;
    if (delegatedModels && delegatedModels.length > 0) {
      logContext.delegatedModels = delegatedModels;
    }
  }

  private resolveRoute(
    dto: ChatCompletionRequestDto,
    apiKey: ApiKeyConfig,
  ): RouteConfig {
    const route = this.configService.findRouteByPublicModel(dto.model);
    if (!route) {
      throw GatewayApiException.modelNotFound(dto.model);
    }
    if (!apiKey.allowedRoutes.includes(route.key)) {
      throw GatewayApiException.forbidden();
    }
    return route;
  }

  /**
   * Spec 005 Fase 1.3: reject requests whose size exceeds the limits declared
   * by the active route BEFORE any orchestration or SSE byte is produced. Each
   * limit is optional in config (`undefined` = unbounded). Violations surface
   * as an OpenAI-compatible 400, never a half-open stream, so this runs
   * synchronously in both the non-streaming and streaming entrypoints.
   */
  private enforceRouteLimits(
    dto: ChatCompletionRequestDto,
    route: RouteConfig,
  ): void {
    if (
      route.maxMessages !== undefined &&
      dto.messages.length > route.maxMessages
    ) {
      throw GatewayApiException.badRequest(
        `The request has ${dto.messages.length} messages, which exceeds the route limit of ${route.maxMessages}.`,
        'too_many_messages',
        'messages',
      );
    }

    if (route.maxMessageContentLength !== undefined) {
      const limit = route.maxMessageContentLength;
      const offending = dto.messages.findIndex(
        (message) => message.content.length > limit,
      );
      if (offending !== -1) {
        throw GatewayApiException.badRequest(
          `Message at index ${offending} exceeds the route content-length limit of ${limit} characters.`,
          'message_too_long',
          `messages[${offending}].content`,
        );
      }
    }

    if (route.maxPayloadBytes !== undefined) {
      const payloadBytes = Buffer.byteLength(JSON.stringify(dto), 'utf8');
      if (payloadBytes > route.maxPayloadBytes) {
        throw GatewayApiException.badRequest(
          `The request payload of ${payloadBytes} bytes exceeds the route limit of ${route.maxPayloadBytes} bytes.`,
          'payload_too_large',
        );
      }
    }
  }

  private toOrchestrationRequest(
    dto: ChatCompletionRequestDto,
    route: RouteConfig,
  ): OrchestrationRequest {
    const externalTools = this.extractExternalTools(dto, route);
    return {
      publicModel: dto.model,
      messages: dto.messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: dto.temperature,
      topP: dto.top_p,
      maxTokens: dto.max_tokens,
      stop: dto.stop,
      ...(externalTools ? { externalTools } : {}),
    };
  }

  /**
   * Spec 005 "Tool calling": client-supplied external tools are forwarded to
   * the orchestrator ONLY when the route sets `allowExternalTools`. Otherwise
   * they are dropped and never reach a provider. Malformed entries are skipped
   * and a tool reusing the internal `delegate_llm` name is always rejected, so
   * a client can never surface or shadow the internal delegation tool.
   */
  private extractExternalTools(
    dto: ChatCompletionRequestDto,
    route: RouteConfig,
  ): ToolSpec[] | undefined {
    if (!route.allowExternalTools) {
      return undefined;
    }
    if (!Array.isArray(dto.tools) || dto.tools.length === 0) {
      return undefined;
    }

    const specs: ToolSpec[] = [];
    for (const tool of dto.tools) {
      const fn = this.asRecord(tool)?.function;
      const fnRecord = this.asRecord(fn);
      const name = fnRecord?.name;
      if (typeof name !== 'string' || name.length === 0) {
        continue;
      }
      if (name === DELEGATE_LLM_TOOL_NAME) {
        continue;
      }
      const description = fnRecord?.description;
      const parameters = this.asRecord(fnRecord?.parameters);
      specs.push({
        name,
        description: typeof description === 'string' ? description : '',
        parameters: parameters ?? {},
      });
    }
    return specs.length > 0 ? specs : undefined;
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private buildEnvelope(
    publicModel: string,
    result: OrchestrationResult,
  ): ChatCompletionResponse {
    return {
      id: this.generateId(),
      object: 'chat.completion',
      created: this.now(),
      model: publicModel,
      choices: [
        {
          index: 0,
          message: this.buildMessage(result),
          finish_reason: result.finishReason,
        },
      ],
      usage: {
        prompt_tokens: result.usage.promptTokens,
        completion_tokens: result.usage.completionTokens,
        total_tokens: result.usage.totalTokens,
      },
    };
  }

  /**
   * Builds the assistant message for the envelope. When the final answer
   * requests client-visible tools (spec 005 Fase 6), it carries `tool_calls`
   * in OpenAI format and `content` becomes null if the model produced no text
   * alongside the calls — matching the Chat Completions contract.
   */
  private buildMessage(
    result: OrchestrationResult,
  ): ChatCompletionChoice['message'] {
    if (result.toolCalls && result.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: result.content.length > 0 ? result.content : null,
        tool_calls: result.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    }
    return { role: 'assistant', content: result.content };
  }

  private generateId(): string {
    return `chatcmpl_${randomUUID().replace(/-/g, '')}`;
  }

  private now(): number {
    return Math.floor(Date.now() / 1000);
  }
}
