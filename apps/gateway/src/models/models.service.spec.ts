import { Test } from '@nestjs/testing';
import {
  CONFIG_SERVICE,
  ConfigService,
  PublicModel,
} from '../config/config.interfaces';
import { ModelsService } from './models.service';

function buildFakeConfigService(publicModels: PublicModel[]): ConfigService {
  return {
    get: () => ({ serverPort: 3000, apiKeys: [], routes: [] }),
    findApiKeyByToken: () => undefined,
    findRouteByPublicModel: () => undefined,
    getPublicModels: () => publicModels,
  };
}

describe('ModelsService', () => {
  it('returns the OpenAI list envelope built from getPublicModels(), omitting `created` when unknown', async () => {
    const fakeConfigService = buildFakeConfigService([
      {
        id: 'route/with-created',
        ownedBy: 'open-fusion',
        createdAt: 1710000000,
      },
      { id: 'route/without-created', ownedBy: 'open-fusion' },
    ]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ModelsService,
        { provide: CONFIG_SERVICE, useValue: fakeConfigService },
      ],
    }).compile();

    const service = moduleRef.get(ModelsService);

    expect(service.listModels()).toEqual({
      object: 'list',
      data: [
        {
          id: 'route/with-created',
          object: 'model',
          created: 1710000000,
          owned_by: 'open-fusion',
        },
        {
          id: 'route/without-created',
          object: 'model',
          owned_by: 'open-fusion',
        },
      ],
    });
  });

  it('never emits a `created` key (not even `undefined`) when createdAt is unknown', async () => {
    const fakeConfigService = buildFakeConfigService([
      { id: 'route/no-created', ownedBy: 'acme' },
    ]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ModelsService,
        { provide: CONFIG_SERVICE, useValue: fakeConfigService },
      ],
    }).compile();

    const service = moduleRef.get(ModelsService);
    const [item] = service.listModels().data;

    expect(Object.prototype.hasOwnProperty.call(item, 'created')).toBe(false);
  });

  it('returns an empty data array when there are no public models', async () => {
    const fakeConfigService = buildFakeConfigService([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ModelsService,
        { provide: CONFIG_SERVICE, useValue: fakeConfigService },
      ],
    }).compile();

    const service = moduleRef.get(ModelsService);

    expect(service.listModels()).toEqual({ object: 'list', data: [] });
  });
});
