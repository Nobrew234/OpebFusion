import { appendLog, setLogSink } from './log-file';
import { MemoryLogSink } from './log-sink';
import { clearKnownSecrets, setKnownSecrets } from './sanitize';

/**
 * These exercise the REAL write path via an injected sink — the behavior that
 * used to be unreachable under Jest because the only executed branch was the
 * `JEST_WORKER_ID` no-op (spec 006, "Testabilidade").
 */
describe('appendLog (spec 006)', () => {
  let sink: MemoryLogSink;

  beforeEach(() => {
    sink = new MemoryLogSink();
    setLogSink(sink);
  });

  afterEach(() => clearKnownSecrets());

  it('writes a structured JSON line with UTC timestamp, level and event', () => {
    appendLog('info', 'request.completed', {
      requestId: 'req-1',
      status: 200,
    });

    expect(sink.records).toHaveLength(1);
    const record = sink.records[0];
    expect(record.level).toBe('info');
    expect(record.msg).toBe('request.completed');
    expect(record.requestId).toBe('req-1');
    expect(record.status).toBe(200);
    // ISO-8601 UTC (ends in Z).
    expect(String(record.t)).toMatch(/Z$/);
  });

  it('sanitizes secrets in EVERY field before the line reaches the sink', () => {
    setKnownSecrets(['registered-provider-secret']);
    appendLog('error', 'exception.caught', {
      message: 'upstream failed for registered-provider-secret',
      stack:
        'Error: 401\n at fetch (https://openrouter.ai/api/v1?token=leakedtok123456)\n Authorization: Bearer sk-leakedbearerkey123',
    });

    const raw = sink.lines.join('');
    expect(raw).not.toContain('registered-provider-secret');
    expect(raw).not.toContain('leakedtok123456');
    expect(raw).not.toContain('sk-leakedbearerkey123');
    expect(raw).toContain('[REDACTED]');
  });

  it('degrades a circular reference to a minimal valid entry instead of throwing', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;

    expect(() => appendLog('warn', 'weird', circular)).not.toThrow();

    expect(sink.records).toHaveLength(1);
    const record = sink.records[0];
    expect(record.level).toBe('warn');
    expect(record.msg).toBe('weird');
  });

  it('neutralizes log injection from client-controlled fields via JSON serialization', () => {
    // A newline/quote-laden model string must not create a second log line.
    appendLog('info', 'request.completed', {
      path: '/v1/chat/completions',
      model: 'evil\n{"level":"error","msg":"forged"}',
    });

    // Exactly one physical line written; the payload stays inside one JSON object.
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0].model).toBe(
      'evil\n{"level":"error","msg":"forged"}',
    );
    // The raw line has the newline escaped, not literal.
    expect(sink.lines[0]).toContain('evil\\n');
    expect(sink.lines[0].trimEnd().split('\n')).toHaveLength(1);
  });

  it('never throws into the request path even if the sink throws', () => {
    setLogSink({
      write() {
        throw new Error('disk on fire');
      },
      async flush() {},
    });
    expect(() => appendLog('info', 'boot', { port: 3000 })).not.toThrow();
  });
});
