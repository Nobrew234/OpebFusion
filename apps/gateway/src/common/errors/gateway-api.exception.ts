import { HttpException, HttpStatus } from '@nestjs/common';

export type GatewayErrorType =
  | 'invalid_request_error'
  | 'authentication_error'
  | 'permission_error'
  | 'timeout_error'
  | 'rate_limit_error'
  | 'api_error';

export interface GatewayErrorBody {
  error: {
    message: string;
    type: GatewayErrorType;
    param: string | null;
    code: string;
  };
}

/**
 * Every error the gateway deliberately raises (as opposed to an unexpected
 * internal exception) must be one of these, so the exception filter can
 * render the OpenAI-compatible envelope without ever touching a raw
 * provider/error message. See docs/specs/001-openai-compatible-api.md ("Erros").
 */
export class GatewayApiException extends HttpException {
  constructor(
    status: number,
    type: GatewayErrorType,
    message: string,
    code: string,
    param: string | null = null,
  ) {
    const body: GatewayErrorBody = { error: { message, type, param, code } };
    super(body, status);
  }

  static badRequest(message: string, code = 'invalid_request', param: string | null = null): GatewayApiException {
    return new GatewayApiException(HttpStatus.BAD_REQUEST, 'invalid_request_error', message, code, param);
  }

  static unauthorized(message = 'Missing or invalid API key.', code = 'invalid_api_key'): GatewayApiException {
    return new GatewayApiException(HttpStatus.UNAUTHORIZED, 'authentication_error', message, code);
  }

  static forbidden(message = 'This API key is not allowed to use this model.', code = 'route_not_allowed'): GatewayApiException {
    return new GatewayApiException(HttpStatus.FORBIDDEN, 'permission_error', message, code);
  }

  static modelNotFound(model: string): GatewayApiException {
    return new GatewayApiException(
      HttpStatus.NOT_FOUND,
      'invalid_request_error',
      `The model '${model}' does not exist.`,
      'model_not_found',
      'model',
    );
  }

  static timeout(message = 'The request timed out.', code = 'timeout'): GatewayApiException {
    return new GatewayApiException(HttpStatus.REQUEST_TIMEOUT, 'timeout_error', message, code);
  }

  static rateLimited(message = 'Rate limit exceeded.', code = 'rate_limit_exceeded'): GatewayApiException {
    return new GatewayApiException(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', message, code);
  }

  static internal(message = 'Internal server error.', code = 'internal_error'): GatewayApiException {
    return new GatewayApiException(HttpStatus.INTERNAL_SERVER_ERROR, 'api_error', message, code);
  }

  static providerError(message = 'Upstream provider returned an error.', code = 'provider_error'): GatewayApiException {
    return new GatewayApiException(HttpStatus.BAD_GATEWAY, 'api_error', message, code);
  }

  static providerUnavailable(message = 'Upstream provider is unavailable.', code = 'provider_unavailable'): GatewayApiException {
    return new GatewayApiException(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', message, code);
  }
}
