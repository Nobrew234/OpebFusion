import {
  ApiKeyConfig,
  ConfigService,
  RouteConfig,
} from '../config/config.interfaces';
import {
  OrchestrationChunk,
  OrchestrationRequest,
  OrchestrationResult,
  OrchestrationService,
} from '../orchestration/orchestration.interfaces';
import { GatewayApiException } from '../common/errors/gateway-api.exception';
import { ChatCompletionRequestDto } from './dto/chat-completion-request.dto';
import { MessageDto } from './dto/message.dto';
import { ChatCompletionsService } from './chat-completions.service';

function buildDto(
  overrides: Partial<ChatCompletionRequestDto> = {},
): ChatCompletionRequestDto {
  const dto = new ChatCompletionRequestDto();
  dto.model = 'gpt-4o';
  dto.messages = [
    Object.assign(new MessageDto(), { role: 'user', content: 'Hello there' }),
  ];
  Object.assign(dto, overrides);
  return dto;
}

function makeRoute(
  key: string,
  publicModel: string,
  overrides: Partial<RouteConfig> = {},
): RouteConfig {
  return {
    key,
    publicModel,
    orchestrator: 'orchestrator.default',
    allowedDelegateModels: [],
    maxDelegations: 0,
    maxDepth: 1,
    streamFinalOnly: true,
    ...overrides,
  };
}

const allowedRoute: RouteConfig = makeRoute('route-a', 'gpt-4o');
const forbiddenRoute: RouteConfig = makeRoute('route-b', 'restricted-model');

const apiKey: ApiKeyConfig = {
  id: 'key-1',
  token: 'secret-token',
  allowedRoutes: ['route-a'],
};

function makeFakeConfigService(routes: RouteConfig[]): ConfigService {
  return {
    get: () => ({
      serverPort: 3000,
      apiKeys: [apiKey],
      providers: [],
      models: [],
      routes,
      observability: { logLevel: 'info', redact: [] },
    }),
    findApiKeyByToken: (token: string) =>
      token === apiKey.token ? apiKey : undefined,
    findRouteByPublicModel: (publicModel: string) =>
      routes.find((r) => r.publicModel === publicModel),
    findModelByKey: () => undefined,
    findProviderByName: () => undefined,
    getObservability: () => ({ logLevel: 'info', redact: [] }),
    getPublicModels: () =>
      routes.map((r) => ({ id: r.publicModel, ownedBy: 'open-fusion' })),
  };
}

function makeFakeOrchestrationService(): OrchestrationService {
  return {
    generate: (request: OrchestrationRequest): Promise<OrchestrationResult> =>
      Promise.resolve({
        content: `Echo: ${request.messages[request.messages.length - 1].content}`,
        finishReason: 'stop',
        usage: { promptTokens: 2, completionTokens: 2, totalTokens: 4 },
      }),
    stream: async function* (): AsyncIterable<OrchestrationChunk> {
      await Promise.resolve();
      yield { delta: 'Echo:', finishReason: null };
      yield { delta: ' hi', finishReason: null };
      yield { delta: '', finishReason: 'stop' };
    },
  };
}

describe('ChatCompletionsService', () => {
  describe('createCompletion (non-streaming)', () => {
    it('returns a chat.completion envelope for an allowed route', async () => {
      const service = new ChatCompletionsService(
        makeFakeConfigService([allowedRoute]),
        makeFakeOrchestrationService(),
      );
      const dto = buildDto();
      const envelope = await service.createCompletion(dto, apiKey);

      expect(envelope.id).toMatch(/^chatcmpl_[a-f0-9]+$/);
      expect(envelope.object).toBe('chat.completion');
      expect(envelope.model).toBe('gpt-4o');
      expect(envelope.choices).toHaveLength(1);
      expect(envelope.choices[0].index).toBe(0);
      expect(envelope.choices[0].message).toEqual({
        role: 'assistant',
        content: 'Echo: Hello there',
      });
      expect(envelope.choices[0].finish_reason).toBe('stop');
      expect(envelope.usage).toEqual({
        prompt_tokens: 2,
        completion_tokens: 2,
        total_tokens: 4,
      });
      expect(typeof envelope.created).toBe('number');
    });

    it('throws GatewayApiException 404 when the model has no matching route', async () => {
      const service = new ChatCompletionsService(
        makeFakeConfigService([]),
        makeFakeOrchestrationService(),
      );
      const dto = buildDto({ model: 'unknown-model' });

      try {
        await service.createCompletion(dto, apiKey);
        fail('expected rejection');
      } catch (err) {
        expect(err).toBeInstanceOf(GatewayApiException);
        expect((err as GatewayApiException).getStatus()).toBe(404);
      }
    });

    it('throws GatewayApiException 403 when the route is not in allowedRoutes', async () => {
      const service = new ChatCompletionsService(
        makeFakeConfigService([forbiddenRoute]),
        makeFakeOrchestrationService(),
      );
      const dto = buildDto({ model: 'restricted-model' });

      try {
        await service.createCompletion(dto, apiKey);
        fail('expected rejection');
      } catch (err) {
        expect(err).toBeInstanceOf(GatewayApiException);
        expect((err as GatewayApiException).getStatus()).toBe(403);
      }
    });
  });

  describe('route limit enforcement (spec 005 Fase 1)', () => {
    function serviceWithRoute(route: RouteConfig): ChatCompletionsService {
      const keyForRoute: ApiKeyConfig = {
        id: 'key-1',
        token: 'secret-token',
        allowedRoutes: [route.key],
      };
      const config = makeFakeConfigService([route]);
      config.findApiKeyByToken = (token: string) =>
        token === keyForRoute.token ? keyForRoute : undefined;
      return new ChatCompletionsService(config, makeFakeOrchestrationService());
    }

    function makeMessages(count: number, content = 'hi'): MessageDto[] {
      return Array.from({ length: count }, () =>
        Object.assign(new MessageDto(), { role: 'user', content }),
      );
    }

    it('rejects with 400 when the message count exceeds maxMessages', async () => {
      const route = makeRoute('route-a', 'gpt-4o', { maxMessages: 2 });
      const service = serviceWithRoute(route);
      const dto = buildDto({ messages: makeMessages(3) });

      try {
        await service.createCompletion(dto, apiKey);
        fail('expected rejection');
      } catch (err) {
        expect(err).toBeInstanceOf(GatewayApiException);
        expect((err as GatewayApiException).getStatus()).toBe(400);
      }
    });

    it('rejects with 400 when a message content exceeds maxMessageContentLength', async () => {
      const route = makeRoute('route-a', 'gpt-4o', {
        maxMessageContentLength: 5,
      });
      const service = serviceWithRoute(route);
      const dto = buildDto({ messages: makeMessages(1, 'way too long') });

      try {
        await service.createCompletion(dto, apiKey);
        fail('expected rejection');
      } catch (err) {
        expect(err).toBeInstanceOf(GatewayApiException);
        expect((err as GatewayApiException).getStatus()).toBe(400);
      }
    });

    it('rejects with 400 when the serialized payload exceeds maxPayloadBytes', async () => {
      const route = makeRoute('route-a', 'gpt-4o', { maxPayloadBytes: 10 });
      const service = serviceWithRoute(route);
      const dto = buildDto({
        messages: makeMessages(1, 'a fairly long message'),
      });

      try {
        await service.createCompletion(dto, apiKey);
        fail('expected rejection');
      } catch (err) {
        expect(err).toBeInstanceOf(GatewayApiException);
        expect((err as GatewayApiException).getStatus()).toBe(400);
      }
    });

    it('accepts a request within all configured limits', async () => {
      const route = makeRoute('route-a', 'gpt-4o', {
        maxMessages: 5,
        maxMessageContentLength: 100,
        maxPayloadBytes: 100000,
      });
      const service = serviceWithRoute(route);
      const dto = buildDto({ messages: makeMessages(2) });

      const envelope = await service.createCompletion(dto, apiKey);
      expect(envelope.object).toBe('chat.completion');
    });

    it('enforces limits synchronously in prepareStream before any chunk', () => {
      const route = makeRoute('route-a', 'gpt-4o', { maxMessages: 1 });
      const service = serviceWithRoute(route);
      const dto = buildDto({ messages: makeMessages(3), stream: true });

      expect(() => service.prepareStream(dto, apiKey)).toThrow(
        GatewayApiException,
      );
    });
  });

  describe('prepareStream (streaming)', () => {
    it('resolves route/auth eagerly and exposes id/created/model plus the chunk iterable', async () => {
      const service = new ChatCompletionsService(
        makeFakeConfigService([allowedRoute]),
        makeFakeOrchestrationService(),
      );
      const dto = buildDto({ stream: true });

      const meta = service.prepareStream(dto, apiKey);
      expect(meta.id).toMatch(/^chatcmpl_[a-f0-9]+$/);
      expect(typeof meta.created).toBe('number');
      expect(meta.model).toBe('gpt-4o');

      const chunks: OrchestrationChunk[] = [];
      for await (const chunk of meta.chunks) {
        chunks.push(chunk);
      }
      expect(chunks.map((c) => c.delta).join('')).toBe('Echo: hi');
      expect(chunks[chunks.length - 1].finishReason).toBe('stop');
    });

    it('throws synchronously (before returning) on 404 for prepareStream', () => {
      const service = new ChatCompletionsService(
        makeFakeConfigService([]),
        makeFakeOrchestrationService(),
      );
      const dto = buildDto({ model: 'unknown-model', stream: true });

      expect(() => service.prepareStream(dto, apiKey)).toThrow(
        GatewayApiException,
      );
    });

    it('throws on 403 for prepareStream when route is not allowed', () => {
      const service = new ChatCompletionsService(
        makeFakeConfigService([forbiddenRoute]),
        makeFakeOrchestrationService(),
      );
      const dto = buildDto({ model: 'restricted-model', stream: true });

      expect(() => service.prepareStream(dto, apiKey)).toThrow(
        GatewayApiException,
      );
    });
  });
});
