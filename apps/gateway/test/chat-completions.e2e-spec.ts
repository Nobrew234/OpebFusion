import {
  Global,
  INestApplication,
  Module,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import {
  AppConfig,
  ApiKeyConfig,
  CONFIG_SERVICE,
  ConfigService,
  RouteConfig,
} from '../src/config/config.interfaces';
import { ChatCompletionsModule } from '../src/chat-completions/chat-completions.module';
import type { ChatCompletionResponse } from '../src/chat-completions/chat-completions.service';
import { OrchestrationModule } from '../src/orchestration/orchestration.module';
import type { GatewayErrorBody } from '../src/common/errors/gateway-api.exception';

interface ChatCompletionStreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: [
    {
      index: 0;
      delta: { role?: 'assistant'; content?: string };
      finish_reason: string | null;
    },
  ];
}

const allowedApiKey: ApiKeyConfig = {
  id: 'key-1',
  token: 'test-gateway-token',
  allowedRoutes: ['route-allowed'],
};

const routes: RouteConfig[] = [
  { key: 'route-allowed', publicModel: 'gpt-4o' },
  { key: 'route-restricted', publicModel: 'restricted-model' },
];

const fixtureAppConfig: AppConfig = {
  serverPort: 3000,
  apiKeys: [allowedApiKey],
  routes,
};

const fakeConfigService: ConfigService = {
  get: () => fixtureAppConfig,
  findApiKeyByToken: (token: string) =>
    fixtureAppConfig.apiKeys.find((k) => k.token === token),
  findRouteByPublicModel: (publicModel: string) =>
    fixtureAppConfig.routes.find((r) => r.publicModel === publicModel),
  getPublicModels: () =>
    fixtureAppConfig.routes.map((r) => ({
      id: r.publicModel,
      ownedBy: 'open-fusion',
    })),
};

// ChatCompletionsModule deliberately does not provide CONFIG_SERVICE itself
// (it's bound globally by the integrator's ConfigModule at runtime), and
// Nest's module encapsulation means a top-level testing-module `providers`
// entry is NOT visible to providers inside an imported feature module. So
// the fake must be exported from its own tiny module and imported
// alongside ChatCompletionsModule, exactly like the real ConfigModule would
// be at runtime.
@Global()
@Module({
  providers: [{ provide: CONFIG_SERVICE, useValue: fakeConfigService }],
  exports: [CONFIG_SERVICE],
})
class FakeConfigModule {}

describe('POST /chat/completions (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [FakeConfigModule, ChatCompletionsModule, OrchestrationModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const validBody = {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hello there' }],
  };

  describe('non-streaming', () => {
    it('returns a chat.completion envelope for a valid request and token', async () => {
      const res = await request(app.getHttpServer())
        .post('/chat/completions')
        .set('Authorization', `Bearer ${allowedApiKey.token}`)
        .send(validBody)
        .expect(200);

      const body = res.body as ChatCompletionResponse;
      expect(body.id).toMatch(/^chatcmpl_/);
      expect(body.object).toBe('chat.completion');
      expect(body.model).toBe('gpt-4o');
      expect(body.choices[0].finish_reason).toBe('stop');
      expect(body.choices[0].message.role).toBe('assistant');
    });

    it('returns 404 for an unknown model', async () => {
      const res = await request(app.getHttpServer())
        .post('/chat/completions')
        .set('Authorization', `Bearer ${allowedApiKey.token}`)
        .send({ ...validBody, model: 'does-not-exist' })
        .expect(404);

      const body = res.body as GatewayErrorBody;
      expect(body.error.code).toBe('model_not_found');
    });

    it('returns 403 for a model whose route is not in allowedRoutes', async () => {
      const res = await request(app.getHttpServer())
        .post('/chat/completions')
        .set('Authorization', `Bearer ${allowedApiKey.token}`)
        .send({ ...validBody, model: 'restricted-model' })
        .expect(403);

      const body = res.body as GatewayErrorBody;
      expect(body.error.type).toBe('permission_error');
    });

    it('returns 401 when no Authorization header is present', async () => {
      await request(app.getHttpServer())
        .post('/chat/completions')
        .send(validBody)
        .expect(401);
    });
  });

  describe('streaming', () => {
    it('streams SSE chunks that concatenate to non-empty content and terminate with [DONE]', async () => {
      const res = await request(app.getHttpServer())
        .post('/chat/completions')
        .set('Authorization', `Bearer ${allowedApiKey.token}`)
        .send({ ...validBody, stream: true })
        .expect(200);

      expect(res.headers['content-type']).toContain('text/event-stream');

      const rawLines = res.text
        .split('\n')
        .filter((line) => line.startsWith('data: '));
      expect(rawLines.length).toBeGreaterThan(1);
      expect(rawLines[rawLines.length - 1]).toBe('data: [DONE]');

      const dataLines = rawLines
        .slice(0, -1)
        .map(
          (line) =>
            JSON.parse(
              line.slice('data: '.length),
            ) as ChatCompletionStreamChunk,
        );
      const content = dataLines
        .map((chunk) => chunk.choices[0].delta.content ?? '')
        .join('');
      expect(content.length).toBeGreaterThan(0);

      const terminal = dataLines[dataLines.length - 1];
      expect(terminal.choices[0].finish_reason).toBe('stop');
      expect(terminal.choices[0].delta).toEqual({});

      const first = dataLines[0];
      expect(first.choices[0].delta).toEqual({ role: 'assistant' });
      expect(first.choices[0].finish_reason).toBeNull();
    });
  });
});
