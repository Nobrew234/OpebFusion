import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { appendLog } from '../logging/log-file';
import { getRequestLogContext } from '../logging/request-context';
import { GatewayErrorBody, GatewayErrorType } from './gateway-api.exception';

/**
 * Last-resort exception filter: converts anything thrown inside the gateway
 * into the OpenAI-compatible error envelope (docs/specs/001-openai-compatible-api.md,
 * "Erros"). Registered globally via ErrorsModule (APP_FILTER), so no wiring
 * is needed in main.ts.
 *
 * Per AGENTS.md: "Falha antes do primeiro chunk -> erro HTTP no envelope
 * OpenAI-compatible ... sem vazar stack trace, segredo ou detalhe interno."
 * The non-HttpException branch below is the one invariant this class exists
 * to enforce — never forward the original error's message/stack/props.
 */
@Catch()
export class OpenAiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Record the ORIGINAL error before it is hidden from the wire. The client
    // only ever sees the generic OpenAI envelope below (no stack, no provider
    // detail), so this file line is the sole surviving trace of what actually
    // went wrong. `message`/`stack` frequently embed a provider URL with a
    // token, an `Authorization` fragment, or the user's prompt — appendLog
    // sanitizes every field before it reaches disk (spec 006), so persisting
    // them here is safe and never leaks a secret.
    appendLog('error', 'exception.caught', {
      requestId: getRequestLogContext(request).requestId,
      name: exception instanceof Error ? exception.name : typeof exception,
      status: exception instanceof HttpException ? exception.getStatus() : 500,
      message:
        exception instanceof Error ? exception.message : String(exception),
      stack: exception instanceof Error ? exception.stack : undefined,
    });

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (isGatewayErrorBody(body)) {
        response.status(status).json(body);
        return;
      }

      response
        .status(status)
        .json(toOpenAiEnvelope(status, body, exception.message));
      return;
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        message: 'Internal server error.',
        type: 'api_error',
        param: null,
        code: 'internal_error',
      },
    });
  }
}

function isGatewayErrorBody(body: unknown): body is GatewayErrorBody {
  if (typeof body !== 'object' || body === null) {
    return false;
  }
  const error = (body as Record<string, unknown>).error;
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const e = error as Record<string, unknown>;
  return (
    typeof e.message === 'string' &&
    typeof e.type === 'string' &&
    'param' in e &&
    typeof e.code === 'string'
  );
}

function toOpenAiEnvelope(
  status: HttpStatus,
  body: unknown,
  fallbackMessage: string,
): GatewayErrorBody {
  return {
    error: {
      message: extractMessage(body, fallbackMessage),
      type: typeForStatus(status),
      param: null,
      code: 'error',
    },
  };
}

function extractMessage(body: unknown, fallbackMessage: string): string {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const message = (body as Record<string, unknown>).message;
    if (Array.isArray(message)) {
      return message.filter((m) => typeof m === 'string').join('; ');
    }
    if (typeof message === 'string') {
      return message;
    }
  }
  return fallbackMessage;
}

function typeForStatus(status: HttpStatus): GatewayErrorType {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'invalid_request_error';
    case HttpStatus.UNAUTHORIZED:
      return 'authentication_error';
    case HttpStatus.FORBIDDEN:
      return 'permission_error';
    case HttpStatus.NOT_FOUND:
      return 'invalid_request_error';
    case HttpStatus.REQUEST_TIMEOUT:
      return 'timeout_error';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'rate_limit_error';
    default:
      return 'api_error';
  }
}
