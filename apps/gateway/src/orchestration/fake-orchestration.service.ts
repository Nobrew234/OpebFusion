import { Injectable } from '@nestjs/common';
import {
  ChatMessage,
  FinishReason,
  OrchestrationChunk,
  OrchestrationRequest,
  OrchestrationResult,
  OrchestrationService,
  OrchestrationUsage,
} from './orchestration.interfaces';

/**
 * Deterministic stand-in for spec 002's real LLM-orchestrated routing
 * engine, which does not exist yet. Spec 001 only needs a stable target
 * behind the OrchestrationService seam so the HTTP contract (envelope, SSE
 * framing, error mapping) can be built and tested without a live provider
 * call. This class must be swappable for the real orchestrator later
 * without any change to ChatCompletionsController/Service.
 */
@Injectable()
export class FakeOrchestrationService implements OrchestrationService {
  async generate(request: OrchestrationRequest): Promise<OrchestrationResult> {
    await Promise.resolve();
    const content = this.buildContent(request.messages);
    const usage = this.buildUsage(request.messages, content);
    return {
      content,
      finishReason: 'stop',
      usage,
    };
  }

  async *stream(
    request: OrchestrationRequest,
  ): AsyncIterable<OrchestrationChunk> {
    await Promise.resolve();
    const content = this.buildContent(request.messages);
    const words = content.split(' ');

    for (let i = 0; i < words.length; i++) {
      const delta = i === 0 ? words[i] : ` ${words[i]}`;
      yield { delta, finishReason: null };
    }

    const finishReason: FinishReason = 'stop';
    yield { delta: '', finishReason };
  }

  private buildContent(messages: ChatMessage[]): string {
    const lastUserMessage = [...messages]
      .reverse()
      .find((m) => m.role === 'user');
    if (!lastUserMessage) {
      throw new Error(
        'FakeOrchestrationService requires at least one user message.',
      );
    }
    return `Echo: ${lastUserMessage.content}`;
  }

  private buildUsage(
    messages: ChatMessage[],
    content: string,
  ): OrchestrationUsage {
    const promptTokens =
      messages.reduce((sum, m) => sum + this.wordCount(m.content), 0) || 1;
    const completionTokens = this.wordCount(content) || 1;
    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };
  }

  private wordCount(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }
}
