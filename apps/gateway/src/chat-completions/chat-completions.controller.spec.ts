import type { Response } from 'express';
import { setLogSink } from '../common/logging/log-file';
import { MemoryLogSink } from '../common/logging/log-sink';
import type { AuthenticatedRequest } from '../auth/auth.interfaces';
import type { OrchestrationChunk } from '../orchestration/orchestration.interfaces';
import { ChatCompletionsController } from './chat-completions.controller';
import type { ChatCompletionsService } from './chat-completions.service';
import type { ChatCompletionRequestDto } from './dto/chat-completion-request.dto';

function mockResponse() {
  const res: Partial<Response> & { written: string[]; ended: boolean } = {
    written: [],
    ended: false,
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    write: jest.fn(function (this: void, chunk: string) {
      res.written.push(chunk);
      return true;
    }),
    end: jest.fn(function (this: void) {
      res.ended = true;
      return res as Response;
    }),
  };
  return res as Response & { written: string[]; ended: boolean };
}

function mockRequest(): AuthenticatedRequest {
  return {
    method: 'POST',
    url: '/v1/chat/completions',
    headers: {},
    apiKey: { id: 'k', token: 't', allowedRoutes: ['default'] },
  } as unknown as AuthenticatedRequest;
}

describe('ChatCompletionsController streaming (spec 006)', () => {
  let sink: MemoryLogSink;

  beforeEach(() => {
    sink = new MemoryLogSink();
    setLogSink(sink);
  });

  it('logs an error entry (not a silent swallow) when the stream fails after the first chunk', async () => {
    async function* failingChunks(): AsyncGenerator<OrchestrationChunk> {
      yield { delta: 'Hello', finishReason: null };
      await Promise.resolve();
      throw new Error('provider stream aborted');
    }

    const service = {
      prepareStream: jest.fn().mockReturnValue({
        id: 'chatcmpl_1',
        created: 1,
        model: 'open-fusion/default',
        chunks: failingChunks(),
      }),
    } as unknown as ChatCompletionsService;

    const controller = new ChatCompletionsController(service);
    const req = mockRequest();
    const res = mockResponse();
    const dto = {
      model: 'open-fusion/default',
      stream: true,
      messages: [],
    } as unknown as ChatCompletionRequestDto;

    await controller.create(dto, req, res);

    // The failure is recorded with a distinguishing error entry...
    const failure = sink.records.find((r) => r.msg === 'request.failed');
    expect(failure).toBeDefined();
    expect(failure?.level).toBe('error');
    expect(failure?.stream).toBe(true);
    expect(failure?.phase).toBe('stream');
    expect(typeof failure?.category).toBe('string');
    expect(typeof failure?.requestId).toBe('string');
    expect(typeof failure?.ms).toBe('number');

    // ...and the stream is still closed cleanly, without leaking the error.
    expect(res.ended).toBe(true);
    const wire = res.written.join('');
    expect(wire).toContain('[DONE]');
    expect(wire).not.toContain('provider stream aborted');
  });

  it('flags the request context so the interceptor cannot report it as success', async () => {
    async function* failingChunks(): AsyncGenerator<OrchestrationChunk> {
      yield { delta: 'Hi', finishReason: null };
      await Promise.resolve();
      throw new Error('timeout waiting for provider');
    }
    const service = {
      prepareStream: jest.fn().mockReturnValue({
        id: 'chatcmpl_2',
        created: 1,
        model: 'open-fusion/default',
        chunks: failingChunks(),
      }),
    } as unknown as ChatCompletionsService;

    const controller = new ChatCompletionsController(service);
    const req = mockRequest();
    const res = mockResponse();
    const dto = {
      model: 'open-fusion/default',
      stream: true,
      messages: [],
    } as unknown as ChatCompletionRequestDto;

    await controller.create(dto, req, res);

    const ctx = (
      req as unknown as { openFusionLog?: { streamError?: boolean } }
    ).openFusionLog;
    expect(ctx?.streamError).toBe(true);
    // Timeout is categorized distinctly.
    const failure = sink.records.find((r) => r.msg === 'request.failed');
    expect(failure?.category).toBe('timeout');
  });
});
