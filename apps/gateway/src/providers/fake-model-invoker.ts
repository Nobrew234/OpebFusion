import { Injectable } from '@nestjs/common';
import {
  InvocationMessage,
  InvocationUsage,
  ModelInvocationRequest,
  ModelInvocationResult,
  ModelInvoker,
  ModelStreamChunk,
} from './model-invoker.interfaces';

/**
 * Deterministic stand-in for the real provider adapters (spec 004), which do
 * not exist yet. It never emits tool calls, so an orchestrator wired to it
 * always "answers directly" — this keeps the application bootable and the
 * spec 001 HTTP-contract e2e tests meaningful before any live provider is
 * connected. It must be swappable for the real adapter-backed invoker without
 * any change to the orchestration engine (the MODEL_INVOKER seam, ADR 0007).
 */
@Injectable()
export class FakeModelInvoker implements ModelInvoker {
  async invoke(
    request: ModelInvocationRequest,
  ): Promise<ModelInvocationResult> {
    await Promise.resolve();
    const content = this.buildContent(request.messages);
    return {
      content,
      toolCalls: [],
      finishReason: 'stop',
      usage: this.buildUsage(request.messages, content),
    };
  }

  async *stream(
    request: ModelInvocationRequest,
  ): AsyncIterable<ModelStreamChunk> {
    await Promise.resolve();
    const content = this.buildContent(request.messages);
    const words = content.split(' ');
    for (let i = 0; i < words.length; i++) {
      yield { delta: i === 0 ? words[i] : ` ${words[i]}`, finishReason: null };
    }
    yield {
      delta: '',
      finishReason: 'stop',
      usage: this.buildUsage(request.messages, content),
    };
  }

  private buildContent(messages: InvocationMessage[]): string {
    const lastUserMessage = [...messages]
      .reverse()
      .find((m) => m.role === 'user');
    if (!lastUserMessage) {
      throw new Error('FakeModelInvoker requires at least one user message.');
    }
    return `Echo: ${lastUserMessage.content}`;
  }

  private buildUsage(
    messages: InvocationMessage[],
    content: string,
  ): InvocationUsage {
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
