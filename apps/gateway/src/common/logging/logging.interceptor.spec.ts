import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';
import { setLogSink } from './log-file';
import { MemoryLogSink } from './log-sink';
import { getRequestLogContext } from './request-context';

function mockContext(
  req: Record<string, unknown>,
  res: Record<string, unknown>,
) {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

describe('LoggingInterceptor (spec 006)', () => {
  let sink: MemoryLogSink;
  let interceptor: LoggingInterceptor;

  beforeEach(() => {
    sink = new MemoryLogSink();
    setLogSink(sink);
    interceptor = new LoggingInterceptor();
  });

  it('stamps a requestId, echoes it on the response header, and logs request.completed', async () => {
    const req = {
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {},
      body: { model: 'open-fusion/default', stream: false },
    };
    const setHeader = jest.fn();
    const res = { statusCode: 200, setHeader };
    const handler: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(interceptor.intercept(mockContext(req, res), handler));

    expect(setHeader).toHaveBeenCalledWith('x-request-id', expect.any(String));
    const record = sink.records[0];
    expect(record.msg).toBe('request.completed');
    expect(record.level).toBe('info');
    expect(record.status).toBe(200);
    expect(typeof record.requestId).toBe('string');
  });

  it('logs the resolved (real) model and delegated models stamped on the context', async () => {
    const req = {
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {},
      body: { model: 'open-fusion/default', stream: false },
    };
    const res = { statusCode: 200, setHeader: jest.fn() };

    // The service layer resolves the public route to a concrete provider model
    // and stamps it on the shared request context before this tap fires.
    const ctx = getRequestLogContext(req);
    ctx.resolvedModel = 'openai/gpt-4.1';
    ctx.delegatedModels = ['openai/gpt-4.1-mini'];

    const handler: CallHandler = { handle: () => of('ok') };
    await lastValueFrom(interceptor.intercept(mockContext(req, res), handler));

    const record = sink.records[0];
    expect(record.model).toBe('open-fusion/default');
    expect(record.resolvedModel).toBe('openai/gpt-4.1');
    expect(record.delegatedModels).toEqual(['openai/gpt-4.1-mini']);
  });

  it('logs request.failed at error level when the handler throws', async () => {
    const req = {
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {},
      body: {},
    };
    const res = { statusCode: 500, setHeader: jest.fn() };
    const handler: CallHandler = {
      handle: () => throwError(() => new Error('boom')),
    };

    await expect(
      lastValueFrom(interceptor.intercept(mockContext(req, res), handler)),
    ).rejects.toThrow('boom');

    const record = sink.records[0];
    expect(record.msg).toBe('request.failed');
    expect(record.level).toBe('error');
  });

  it('marks a completed line as a failure when the stream errored mid-flight (status:200 not mistaken for success)', async () => {
    const req = {
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {},
      body: { model: 'open-fusion/default', stream: true },
    };
    const res = { statusCode: 200, setHeader: jest.fn() };

    // Simulate the controller having flagged a mid-stream failure on the same
    // request context before the interceptor's completion tap fires.
    getRequestLogContext(req).streamError = true;

    const handler: CallHandler = { handle: () => of(undefined) };
    await lastValueFrom(interceptor.intercept(mockContext(req, res), handler));

    const record = sink.records[0];
    expect(record.status).toBe(200);
    expect(record.level).toBe('warn');
    expect(record.streamError).toBe(true);
    expect(record.ok).toBe(false);
  });

  afterAll(() => {
    // Leave a clean sink for other suites in the same worker.
    setLogSink(new MemoryLogSink());
  });
});
