import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { GatewayApiException } from './gateway-api.exception';
import { ErrorsModule } from './errors.module';

@Controller('boom')
class BoomController {
  @Get()
  boom(): never {
    throw GatewayApiException.modelNotFound('foo');
  }
}

/**
 * Integration test: proves importing ErrorsModule alone (as the integrator
 * will in AppModule) is enough to get global OpenAI-compatible error
 * handling, with zero app.useGlobalFilters(...) wiring in main.ts.
 */
describe('ErrorsModule (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ErrorsModule],
      controllers: [BoomController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('renders the OpenAI-compatible envelope for an exception thrown by a route handler', async () => {
    const response = await request(app.getHttpServer()).get('/boom');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        message: "The model 'foo' does not exist.",
        type: 'invalid_request_error',
        param: 'model',
        code: 'model_not_found',
      },
    });
  });
});
