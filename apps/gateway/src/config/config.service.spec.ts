import * as path from 'path';
import { ConfigService } from './config.service';

const FIXTURES_DIR = path.join(
  __dirname,
  '..',
  '..',
  'test',
  'fixtures',
  'config',
);
const fixturePath = (name: string) => path.join(FIXTURES_DIR, name);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('ConfigService', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function setConfigPath(fixtureName: string): void {
    process.env.OPEN_FUSION_CONFIG = fixturePath(fixtureName);
  }

  describe('loading a valid config', () => {
    beforeEach(() => {
      setConfigPath('valid.config.json');
      process.env.OPEN_FUSION_FIXTURE_TOKEN = 'fixture-token-1';
      process.env.OPEN_FUSION_FIXTURE_TOKEN_2 = 'fixture-token-2';
    });

    it('parses server port, api keys and routes from the file', () => {
      const service = new ConfigService();
      const config = service.get();

      expect(config.serverPort).toBe(4001);
      expect(config.apiKeys).toEqual([
        {
          id: 'local-dev',
          token: 'fixture-token-1',
          allowedRoutes: ['default'],
        },
        {
          id: 'second-key',
          token: 'fixture-token-2',
          allowedRoutes: ['default', 'secondary'],
        },
      ]);
      expect(config.routes).toEqual([
        {
          key: 'default',
          publicModel: 'open-fusion/default',
          orchestrator: 'orchestrator.default',
          allowedDelegateModels: ['worker.fast'],
          maxDelegations: 3,
          maxDepth: 1,
          timeoutMs: 60000,
          delegateTimeoutMs: 30000,
          maxMessages: 128,
          maxMessageContentLength: 32768,
          maxPayloadBytes: 1048576,
          streamFinalOnly: true,
        },
        {
          key: 'secondary',
          publicModel: 'open-fusion/secondary',
          orchestrator: 'orchestrator.default',
          allowedDelegateModels: [],
          maxDelegations: 0,
          maxDepth: 1,
          streamFinalOnly: true,
        },
      ]);
    });

    it('parses providers and models from the file', () => {
      const service = new ConfigService();
      const config = service.get();

      expect(config.providers).toEqual([
        {
          name: 'openrouter',
          type: 'openrouter',
          apiKeyEnv: 'OPENROUTER_API_KEY',
          baseUrl: 'https://openrouter.ai/api/v1',
          headers: {
            'HTTP-Referer': 'https://example.com',
            'X-Title': 'Open Fusion',
          },
        },
      ]);
      expect(config.models).toEqual([
        {
          key: 'orchestrator.default',
          provider: 'openrouter',
          model: 'openai/gpt-4.1',
          role: 'orchestrator',
          capabilities: [],
          defaults: { temperature: 0.2 },
        },
        {
          key: 'worker.fast',
          provider: 'openrouter',
          model: 'openai/gpt-4.1-mini',
          role: 'delegate',
          capabilities: ['general', 'fast_draft'],
          defaults: { temperature: 0.3 },
        },
      ]);
    });

    it('findModelByKey returns the matching model', () => {
      const service = new ConfigService();
      expect(service.findModelByKey('worker.fast')?.role).toBe('delegate');
      expect(service.findModelByKey('orchestrator.default')?.role).toBe(
        'orchestrator',
      );
    });

    it('findModelByKey returns undefined for an unknown key', () => {
      const service = new ConfigService();
      expect(service.findModelByKey('nope')).toBeUndefined();
    });

    it('findApiKeyByToken returns the matching api key', () => {
      const service = new ConfigService();
      expect(service.findApiKeyByToken('fixture-token-2')).toEqual({
        id: 'second-key',
        token: 'fixture-token-2',
        allowedRoutes: ['default', 'secondary'],
      });
    });

    it('findApiKeyByToken returns undefined for an unknown token', () => {
      const service = new ConfigService();
      expect(service.findApiKeyByToken('does-not-exist')).toBeUndefined();
    });

    it('findRouteByPublicModel returns the matching route', () => {
      const service = new ConfigService();
      expect(service.findRouteByPublicModel('open-fusion/secondary')).toEqual({
        key: 'secondary',
        publicModel: 'open-fusion/secondary',
        orchestrator: 'orchestrator.default',
        allowedDelegateModels: [],
        maxDelegations: 0,
        maxDepth: 1,
        streamFinalOnly: true,
      });
    });

    it('findRouteByPublicModel returns undefined for an unknown public model', () => {
      const service = new ConfigService();
      expect(service.findRouteByPublicModel('nope')).toBeUndefined();
    });

    it('getPublicModels maps every route to a public model owned by open-fusion', () => {
      const service = new ConfigService();
      expect(service.getPublicModels()).toEqual([
        { id: 'open-fusion/default', ownedBy: 'open-fusion' },
        { id: 'open-fusion/secondary', ownedBy: 'open-fusion' },
      ]);
    });
  });

  describe('resolving the config path', () => {
    it('falls back to ./config/open-fusion.config.json under process.cwd() when OPEN_FUSION_CONFIG is unset', () => {
      delete process.env.OPEN_FUSION_CONFIG;
      process.env.OPEN_FUSION_DEV_API_KEY = 'dev-token';
      const cwdSpy = jest
        .spyOn(process, 'cwd')
        .mockReturnValue(path.join(__dirname, '..', '..'));

      try {
        const service = new ConfigService();
        const config = service.get();
        expect(Number.isInteger(config.serverPort)).toBe(true);
        expect(config.serverPort).toBeGreaterThan(0);
        expect(config.routes.length).toBeGreaterThan(0);
      } finally {
        cwdSpy.mockRestore();
      }
    });

    it('throws a clear error when the config file does not exist', () => {
      setConfigPath('does-not-exist.config.json');
      expect(() => new ConfigService()).toThrow(/does-not-exist\.config\.json/);
    });
  });

  describe('invalid configuration', () => {
    it.each([
      ['missing version', 'invalid-version-missing.config.json', 'version'],
      ['wrong version', 'invalid-version-wrong.config.json', 'version'],
      [
        'missing server.port',
        'invalid-server-port-missing.config.json',
        'server.port',
      ],
      [
        'negative server.port',
        'invalid-server-port-not-positive.config.json',
        'server.port',
      ],
      [
        'non-integer server.port',
        'invalid-server-port-not-integer.config.json',
        'server.port',
      ],
      [
        'missing auth.apiKeys',
        'invalid-auth-apikeys-missing.config.json',
        'auth.apiKeys',
      ],
      [
        'empty auth.apiKeys',
        'invalid-auth-apikeys-empty.config.json',
        'auth.apiKeys',
      ],
      [
        'api key missing id',
        'invalid-apikey-missing-id.config.json',
        'auth.apiKeys[0].id',
      ],
      [
        'api key missing tokenEnv',
        'invalid-apikey-missing-tokenenv.config.json',
        'auth.apiKeys[0].tokenEnv',
      ],
      [
        'api key missing allowedRoutes',
        'invalid-apikey-missing-allowedroutes.config.json',
        'auth.apiKeys[0].allowedRoutes',
      ],
      ['missing routes', 'invalid-routes-missing.config.json', 'routes'],
      ['empty routes', 'invalid-routes-empty.config.json', 'routes'],
      [
        'route missing publicModel',
        'invalid-route-missing-publicmodel.config.json',
        'routes.default.publicModel',
      ],
      [
        'model references unknown provider',
        'invalid-model-unknown-provider.config.json',
        'models.orchestrator.default.provider',
      ],
      [
        'route maxDepth not 1',
        'invalid-route-maxdepth-not-one.config.json',
        'routes.default.maxDepth',
      ],
      [
        'route orchestrator has delegate role',
        'invalid-route-orchestrator-role.config.json',
        'routes.default.orchestrator',
      ],
      [
        'allowedDelegateModels entry has orchestrator role',
        'invalid-route-delegate-role.config.json',
        'routes.default.allowedDelegateModels[0]',
      ],
    ])(
      'throws naming the field path for %s',
      (_label, fixture, expectedFieldPath) => {
        setConfigPath(fixture);
        process.env.OPEN_FUSION_FIXTURE_TOKEN = 'fixture-token-1';
        process.env.OPEN_FUSION_FIXTURE_TOKEN_2 = 'fixture-token-2';

        expect(() => new ConfigService()).toThrow(
          new RegExp(escapeRegExp(expectedFieldPath)),
        );
      },
    );

    it('throws when a malformed JSON file cannot be parsed', () => {
      setConfigPath('malformed.config.json');
      expect(() => new ConfigService()).toThrow();
    });

    it('throws naming the tokenEnv variable when it is not set in the environment', () => {
      setConfigPath('valid.config.json');
      delete process.env.OPEN_FUSION_FIXTURE_TOKEN;
      process.env.OPEN_FUSION_FIXTURE_TOKEN_2 = 'fixture-token-2';

      expect(() => new ConfigService()).toThrow(/OPEN_FUSION_FIXTURE_TOKEN/);
    });
  });

  describe('secret handling', () => {
    it('never includes a resolved secret value in a thrown error message', () => {
      setConfigPath('invalid-route-missing-publicmodel.config.json');
      const secretValue = 'super-secret-fixture-token-do-not-leak';
      process.env.OPEN_FUSION_FIXTURE_TOKEN = secretValue;

      let caught: Error | undefined;
      try {
        new ConfigService();
      } catch (err) {
        caught = err as Error;
      }

      expect(caught).toBeDefined();
      expect(caught!.message).not.toContain(secretValue);
    });

    it('does not leak an already-resolved sibling key secret into an unrelated tokenEnv error', () => {
      // valid.config.json has two api keys, validated in array order:
      // local-dev (OPEN_FUSION_FIXTURE_TOKEN) at index 0, second-key
      // (OPEN_FUSION_FIXTURE_TOKEN_2) at index 1. Resolving local-dev's
      // secret succeeds first and is held in memory; second-key's tokenEnv
      // is then found unset and the error thrown for it must name only
      // second-key's env var, never leaking local-dev's already-resolved value.
      setConfigPath('valid.config.json');
      const siblingSecretValue = 'sibling-key-secret-do-not-leak';
      process.env.OPEN_FUSION_FIXTURE_TOKEN = siblingSecretValue;
      delete process.env.OPEN_FUSION_FIXTURE_TOKEN_2;

      let caught: Error | undefined;
      try {
        new ConfigService();
      } catch (err) {
        caught = err as Error;
      }

      expect(caught).toBeDefined();
      expect(caught!.message).toContain('OPEN_FUSION_FIXTURE_TOKEN_2');
      expect(caught!.message).not.toContain(siblingSecretValue);
    });
  });
});
