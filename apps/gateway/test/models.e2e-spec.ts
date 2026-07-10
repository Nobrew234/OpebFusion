import { Global, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CONFIG_SERVICE, ConfigService } from '../src/config/config.interfaces';
import { ModelsModule } from '../src/models/models.module';
import type { OpenAiModelList } from '../src/models/models.service';
import type { GatewayErrorBody } from '../src/common/errors/gateway-api.exception';

const VALID_TOKEN = 'gw-test-token';

function buildFakeConfigService(): ConfigService {
  const apiKey = {
    id: 'key_1',
    token: VALID_TOKEN,
    allowedRoutes: ['default'],
  };
  const publicModels = [
    { id: 'route/default', ownedBy: 'open-fusion', createdAt: 1710000000 },
    { id: 'route/no-created', ownedBy: 'open-fusion' },
  ];

  return {
    get: () => ({
      serverPort: 3000,
      apiKeys: [apiKey],
      providers: [],
      models: [],
      routes: [
        {
          key: 'default',
          publicModel: 'route/default',
          orchestrator: 'orchestrator.default',
          allowedDelegateModels: [],
          maxDelegations: 0,
          maxDepth: 1,
          streamFinalOnly: true,
          allowExternalTools: false,
        },
      ],
      observability: {
        logLevel: 'info',
        redact: [],
        logFile: { maxSizeBytes: 10485760, maxFiles: 5 },
      },
    }),
    findApiKeyByToken: (token: string) =>
      token === VALID_TOKEN ? apiKey : undefined,
    findRouteByPublicModel: () => undefined,
    findModelByKey: () => undefined,
    findProviderByName: () => undefined,
    getObservability: () => ({
      logLevel: 'info',
      redact: [],
      logFile: { maxSizeBytes: 10485760, maxFiles: 5 },
    }),
    getPublicModels: () => publicModels,
  };
}

// Stands in for the real ConfigModule (owned by a sibling agent, not present
// in this isolated worktree/module graph). At runtime the integrator binds
// CONFIG_SERVICE globally the same way; `overrideProvider` can't be used here
// because ModelsModule deliberately does not declare CONFIG_SERVICE itself.
@Global()
@Module({
  providers: [{ provide: CONFIG_SERVICE, useValue: buildFakeConfigService() }],
  exports: [CONFIG_SERVICE],
})
class FakeConfigModule {}

describe('GET /models (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakeConfigModule, ModelsModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the OpenAI list envelope for an authenticated request', async () => {
    const response = await request(app.getHttpServer())
      .get('/models')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .expect(200);

    const body = response.body as OpenAiModelList;
    expect(body).toEqual({
      object: 'list',
      data: [
        {
          id: 'route/default',
          object: 'model',
          created: 1710000000,
          owned_by: 'open-fusion',
        },
        { id: 'route/no-created', object: 'model', owned_by: 'open-fusion' },
      ],
    });
    expect(body.data).toHaveLength(2);
  });

  it('rejects a request with no Authorization header with the OpenAI error envelope', async () => {
    const response = await request(app.getHttpServer())
      .get('/models')
      .expect(401);

    const body = response.body as GatewayErrorBody;
    expect(body.error.type).toBe('authentication_error');
    expect(body.error.param).toBeNull();
    expect(typeof body.error.message).toBe('string');
    expect(typeof body.error.code).toBe('string');
  });

  it('rejects a request with an invalid bearer token', async () => {
    const response = await request(app.getHttpServer())
      .get('/models')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);

    const body = response.body as GatewayErrorBody;
    expect(body.error.type).toBe('authentication_error');
  });
});
