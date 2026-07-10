import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  RequestTimeoutException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { GatewayApiException } from './gateway-api.exception';
import type { GatewayErrorBody } from './gateway-api.exception';
import { OpenAiExceptionFilter } from './openai-exception.filter';

/**
 * Minimal fake ArgumentsHost — enough for ExceptionFilter.catch() to reach
 * `host.switchToHttp().getResponse()`. No real HTTP server needed.
 */
function createMockHost() {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({}),
    }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

describe('OpenAiExceptionFilter', () => {
  let filter: OpenAiExceptionFilter;

  beforeEach(() => {
    filter = new OpenAiExceptionFilter();
  });

  it('sends a GatewayApiException body and status verbatim, without rewrapping', () => {
    const { host, response } = createMockHost();
    const exception = GatewayApiException.modelNotFound('foo');

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      error: {
        message: "The model 'foo' does not exist.",
        type: 'invalid_request_error',
        param: 'model',
        code: 'model_not_found',
      },
    });
  });

  it('maps a generic Nest NotFoundException to the OpenAI envelope', () => {
    const { host, response } = createMockHost();
    const exception = new NotFoundException('route not found');

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(404);
    const [body] = response.json.mock.calls[0] as [GatewayErrorBody];
    expect(body.error.type).toBe('invalid_request_error');
    expect(body.error.message).toBe('route not found');
    expect(body.error.code).toBe('error');
    expect(body.error.param).toBeNull();
  });

  it('joins a Nest ValidationPipe-style array message into one readable string', () => {
    const { host, response } = createMockHost();
    const exception = new BadRequestException([
      'model must be a string',
      'messages must be an array',
    ]);

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(400);
    const [body] = response.json.mock.calls[0] as [GatewayErrorBody];
    expect(body.error.type).toBe('invalid_request_error');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message).toContain('model must be a string');
    expect(body.error.message).toContain('messages must be an array');
    // Must not be a raw array/object dump.
    expect(body.error.message).not.toMatch(/^\[object/);
    expect(body.error.message).not.toContain('[');
  });

  it.each([
    [new UnauthorizedException('invalid token'), 'authentication_error'],
    [new ForbiddenException('not allowed'), 'permission_error'],
    [new RequestTimeoutException('timed out'), 'timeout_error'],
    [
      new HttpException('too many requests', HttpStatus.TOO_MANY_REQUESTS),
      'rate_limit_error',
    ],
    [new ServiceUnavailableException('provider down'), 'api_error'],
  ] as const)(
    'maps %p to type %s by status code',
    (exception, expectedType) => {
      const { host, response } = createMockHost();

      filter.catch(exception, host);

      expect(response.status).toHaveBeenCalledWith(exception.getStatus());
      const [body] = response.json.mock.calls[0] as [GatewayErrorBody];
      expect(body.error.type).toBe(expectedType);
      expect(body.error.code).toBe('error');
      expect(body.error.param).toBeNull();
    },
  );

  it('responds 500 with a generic message for a non-HttpException error, never leaking internal details', () => {
    const { host, response } = createMockHost();
    const exception = new Error('leaked secret token abc123');

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(500);
    const [body] = response.json.mock.calls[0] as [GatewayErrorBody];
    expect(body).toEqual({
      error: {
        message: 'Internal server error.',
        type: 'api_error',
        param: null,
        code: 'internal_error',
      },
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('abc123');
    expect(serialized).not.toContain('leaked secret');
  });
});
