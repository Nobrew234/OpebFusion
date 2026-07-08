import * as path from 'path';
import { Test } from '@nestjs/testing';
import {
  CONFIG_SERVICE,
  ConfigService as ConfigServiceContract,
} from './config.interfaces';
import { ConfigModule } from './config.module';

const FIXTURES_DIR = path.join(
  __dirname,
  '..',
  '..',
  'test',
  'fixtures',
  'config',
);
const fixturePath = (name: string) => path.join(FIXTURES_DIR, name);

describe('ConfigModule', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.OPEN_FUSION_CONFIG = fixturePath('valid.config.json');
    process.env.OPEN_FUSION_FIXTURE_TOKEN = 'fixture-token-1';
    process.env.OPEN_FUSION_FIXTURE_TOKEN_2 = 'fixture-token-2';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('provides CONFIG_SERVICE resolving to a working ConfigService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule],
    }).compile();

    const service = moduleRef.get<ConfigServiceContract>(CONFIG_SERVICE);
    expect(service.get().serverPort).toBe(4001);
    expect(service.getPublicModels()).toEqual([
      { id: 'open-fusion/default', ownedBy: 'open-fusion' },
      { id: 'open-fusion/secondary', ownedBy: 'open-fusion' },
    ]);
  });

  it('fails module compilation when the config is invalid, preventing partial boot', async () => {
    process.env.OPEN_FUSION_CONFIG = fixturePath(
      'invalid-version-wrong.config.json',
    );

    await expect(
      Test.createTestingModule({ imports: [ConfigModule] }).compile(),
    ).rejects.toThrow(/version/);
  });
});
