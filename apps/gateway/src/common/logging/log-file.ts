import { resolve } from 'path';
import {
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_SIZE_BYTES,
  FileLogSink,
  LogSink,
  NullLogSink,
} from './log-sink';
import { sanitizeLogFields, setKnownSecrets } from './sanitize';

/**
 * Structured file logging for the gateway. Everything an operator (or an
 * assistant reading the repo) inspects after the fact is written here as one
 * JSON object per line — request outcomes (LoggingInterceptor), mid-stream
 * failures (ChatCompletionsController), and the *real* internal errors that
 * OpenAiExceptionFilter hides from the client.
 *
 * Spec 006 contract, enforced here so every call site inherits it:
 *   - Sanitization runs on the whole record before serialization, so no secret
 *     reaches disk on any branch (including the circular-ref fallback).
 *   - Serialization degrades to a minimal valid entry on failure and NEVER
 *     throws into the request path.
 *   - Writes go to a configurable, non-blocking {@link LogSink}. The sink is
 *     swappable so the real write path is testable without a `JEST_WORKER_ID`
 *     no-op (the env guard now only picks a *default*, not the behavior).
 */

let cachedPath: string | null = null;
let sink: LogSink | null = null;

export function resolveLogFilePath(): string {
  if (cachedPath) {
    return cachedPath;
  }
  cachedPath = process.env.OPEN_FUSION_LOG_FILE
    ? resolve(process.env.OPEN_FUSION_LOG_FILE)
    : resolve(process.cwd(), 'logs', 'gateway.log');
  return cachedPath;
}

/** The default sink: a no-op under Jest, a rotating file sink otherwise. */
function defaultSink(): LogSink {
  if (process.env.JEST_WORKER_ID !== undefined) {
    return new NullLogSink();
  }
  return new FileLogSink({
    filePath: resolveLogFilePath(),
    maxSizeBytes: DEFAULT_MAX_SIZE_BYTES,
    maxFiles: DEFAULT_MAX_FILES,
  });
}

export function getLogSink(): LogSink {
  if (!sink) {
    sink = defaultSink();
  }
  return sink;
}

/** Dependency-injection seam: swap the sink (tests, alternate transports). */
export function setLogSink(next: LogSink): void {
  sink = next;
}

export interface LoggingSetup {
  /** Registered as exact values to redact wherever they appear in a log line. */
  secrets?: Array<string | undefined>;
  maxSizeBytes?: number;
  maxFiles?: number;
}

/**
 * Boot-time wiring (called from main.ts once config is loaded): registers the
 * resolved secrets so they are redacted by value, and installs a rotating file
 * sink with the configured size/retention. Idempotent and safe to skip — the
 * lazy default already produces a working file sink.
 */
export function configureLogging(setup: LoggingSetup): void {
  setKnownSecrets(setup.secrets ?? []);
  if (process.env.JEST_WORKER_ID !== undefined) {
    return; // keep the test tree clean unless a test injects a sink explicitly
  }
  sink = new FileLogSink({
    filePath: resolveLogFilePath(),
    maxSizeBytes: setup.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES,
    maxFiles: setup.maxFiles ?? DEFAULT_MAX_FILES,
  });
}

/** Flush pending entries on shutdown so nothing already accepted is lost. */
export async function flushLogs(): Promise<void> {
  await getLogSink().flush();
}

export type LogLevel = 'info' | 'warn' | 'error';

/**
 * Appends one structured log entry. Best-effort: any failure past this point is
 * swallowed so logging never breaks a request. `t` is an ISO-8601 UTC timestamp.
 */
export function appendLog(
  level: LogLevel,
  msg: string,
  fields: Record<string, unknown> = {},
): void {
  let line: string;
  try {
    // Sanitize and serialize inside the guard: a circular reference makes both
    // the deep sanitizer and JSON.stringify throw, and either must degrade to a
    // minimal valid entry rather than crash the request path.
    const safeFields = sanitizeLogFields(fields);
    const record = { t: new Date().toISOString(), level, msg, ...safeFields };
    line = JSON.stringify(record) + '\n';
  } catch {
    // Degrade to a minimal but valid entry. `msg` is a fixed internal string,
    // never client-controlled, so the fallback carries no unsanitized data.
    line = JSON.stringify({ t: new Date().toISOString(), level, msg }) + '\n';
  }

  try {
    getLogSink().write(line);
  } catch {
    // Best-effort: a failed write must not break the request.
  }
}
