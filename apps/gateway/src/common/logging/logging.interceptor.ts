import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { appendLog } from './log-file';
import { getRequestLogContext } from './request-context';

/**
 * Logs one line per HTTP request to logs/gateway.log: outcome, latency, the
 * client-requested `model` alias, and the `resolvedModel` (plus any
 * `delegatedModels`) the orchestration layer actually invoked behind that alias
 * — the fields an operator most wants when a client like opencode misbehaves.
 * Registered globally in main.ts. Runs before the route handler, so the
 * `requestId` it stamps is available to the controller and the exception filter
 * for correlation, and the `resolvedModel` the service stamps on the same
 * context is visible here by the time the completion tap fires.
 *
 * The error branch here is intentionally shallow (message only) — the full
 * stack of a swallowed internal error is logged by OpenAiExceptionFilter, which
 * is the only place that still holds the original exception.
 *
 * Streaming caveat (spec 006): a failure *after* the first SSE chunk is caught
 * inside the controller, so the observable completes normally and this success
 * branch fires with `status:200`. The controller flags that case on the request
 * context (`streamError`), which we surface here as an explicit signal so a
 * failed stream is never recorded as an indistinguishable success.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const start = Date.now();

    const logCtx = getRequestLogContext(req);
    res.setHeader('x-request-id', logCtx.requestId);

    // Express types `req.body` as `any`; narrow it to a safe shape before use.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const model = typeof body.model === 'string' ? body.model : undefined;
    const stream = body.stream === true ? true : undefined;

    return next.handle().pipe(
      tap({
        next: () => {
          const streamError = logCtx.streamError === true;
          appendLog(streamError ? 'warn' : 'info', 'request.completed', {
            requestId: logCtx.requestId,
            method: req.method,
            path: req.url,
            status: res.statusCode,
            ms: Date.now() - start,
            model,
            // The real provider model behind the public alias, resolved by the
            // orchestration layer (undefined fields are dropped by appendLog).
            resolvedModel: logCtx.resolvedModel,
            ...(logCtx.delegatedModels?.length
              ? { delegatedModels: logCtx.delegatedModels }
              : {}),
            stream,
            // Additional signal so a stream that died mid-flight is never
            // mistaken for a clean status:200 completion (spec 006).
            ...(streamError ? { streamError: true, ok: false } : {}),
          });
        },
        error: (err: unknown) =>
          appendLog('error', 'request.failed', {
            requestId: logCtx.requestId,
            method: req.method,
            path: req.url,
            ms: Date.now() - start,
            model,
            stream,
            error: err instanceof Error ? err.message : String(err),
          }),
      }),
    );
  }
}
