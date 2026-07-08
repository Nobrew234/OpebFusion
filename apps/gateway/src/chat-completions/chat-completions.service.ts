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
import { ChatCompletionRequestDto } from './dto/chat-completion-request.dto';

export interface ChatCompletionChoice {
  index: 0;
  message: { role: 'assistant'; content: string };
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
  ): Promise<ChatCompletionResponse> {
    this.resolveRoute(dto, apiKey);
    const result = await this.orchestrationService.generate(
      this.toOrchestrationRequest(dto),
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
  ): StreamPreparation {
    this.resolveRoute(dto, apiKey);
    return {
      id: this.generateId(),
      created: this.now(),
      model: dto.model,
      chunks: this.orchestrationService.stream(
        this.toOrchestrationRequest(dto),
      ),
    };
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

  private toOrchestrationRequest(
    dto: ChatCompletionRequestDto,
  ): OrchestrationRequest {
    // tools/tool_choice are intentionally dropped here: no routing/delegation
    // policy exists yet (spec 002), so the fake orchestrator must never see
    // or act on them.
    return {
      publicModel: dto.model,
      messages: dto.messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: dto.temperature,
      topP: dto.top_p,
      maxTokens: dto.max_tokens,
      stop: dto.stop,
    };
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
          message: { role: 'assistant', content: result.content },
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

  private generateId(): string {
    return `chatcmpl_${randomUUID().replace(/-/g, '')}`;
  }

  private now(): number {
    return Math.floor(Date.now() / 1000);
  }
}
