import { randomUUID } from 'node:crypto';

/**
 * Per-request logging state stamped on the Express request object so the
 * interceptor, the streaming controller, and the exception filter can all
 * correlate their log lines under a single `requestId` (spec 006, "Campos
 * estruturados") and so a mid-stream failure can flag itself back to the
 * interceptor (spec 006, "Registro de falhas em todos os caminhos").
 */
export interface RequestLogContext {
  requestId: string;
  /** Set by the streaming controller when a failure occurs after the first
   *  chunk, so the interceptor's completion line is not mistaken for success. */
  streamError?: boolean;
  /**
   * The concrete provider model id that actually produced the answer (e.g.
   * `nvidia/nemotron-nano-9b-v2:free`), stamped by ChatCompletionsService once
   * orchestration resolves the public route. Lets an operator see the *real*
   * model behind a public alias like `open-fusion/default` in the request line,
   * which `model` (the client-requested alias) alone cannot show.
   */
  resolvedModel?: string;
  /** Real provider model ids of any models actually delegated to. */
  delegatedModels?: string[];
}

type WithLogContext = { openFusionLog?: RequestLogContext };

/**
 * Returns the request's log context, creating it (with a fresh `requestId`) on
 * first access. Prefers a client/proxy-supplied `x-request-id` when present and
 * well-formed, so logs can be correlated with upstream traces.
 */
export function getRequestLogContext(req: unknown): RequestLogContext {
  const holder = (req ?? {}) as WithLogContext & {
    headers?: Record<string, unknown>;
  };
  if (holder.openFusionLog) {
    return holder.openFusionLog;
  }
  const header = holder.headers?.['x-request-id'];
  const requestId =
    typeof header === 'string' && /^[\w.-]{1,128}$/.test(header)
      ? header
      : randomUUID();
  const ctx: RequestLogContext = { requestId };
  holder.openFusionLog = ctx;
  return ctx;
}
