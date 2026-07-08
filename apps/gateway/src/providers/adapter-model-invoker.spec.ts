import {
  AppConfig,
  ConfigService,
  ModelConfig,
  ProviderConfig,
} from '../config/config.interfaces';
import { GatewayApiException } from '../common/errors/gateway-api.exception';
import { AdapterModelInvoker } from './adapter-model-invoker';
import {
  ModelInvocationRequest,
  ModelInvocationResult,
  ModelStreamChunk,
} from './model-invoker.interfaces';
import { ProviderAdapter } from './provider-adapter.interfaces';

const models: ModelConfig[] = [
  {
    key: 'worker.fast',
    provider: 'openrouter',
    model: 'openai/gpt-4.1-mini',
    role: 'delegate',
    capabilities: [],
  },
  {
    key: 'orphan.model',
    provider: 'ghost',
    model: 'ghost/model',
    role: 'delegate',
    capabilities: [],
  },
];

const providers: ProviderConfig[] = [
  { name: 'openrouter', type: 'openrouter', apiKey: 'k' },
  { name: 'ghost', type: 'unregistered-type', apiKey: 'k' },
];

function makeConfigService(): ConfigService {
  const config = { providers, models } as unknown as AppConfig;
  return {
    get: () => config,
    findApiKeyByToken: () => undefined,
    findRouteByPublicModel: () => undefined,
    findModelByKey: (key) => models.find((m) => m.key === key),
    findProviderByName: (name) => providers.find((p) => p.name === name),
    getObservability: () => ({ logLevel: 'info', redact: [] }),
    getPublicModels: () => [],
  };
}

class RecordingAdapter implements ProviderAdapter {
  readonly type = 'openrouter';
  readonly invoked: ModelConfig[] = [];

  invoke(model: ModelConfig): Promise<ModelInvocationResult> {
    this.invoked.push(model);
    return Promise.resolve({
      content: `answered by ${model.model}`,
      toolCalls: [],
      finishReason: 'stop',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async *stream(model: ModelConfig): AsyncIterable<ModelStreamChunk> {
    this.invoked.push(model);
    yield { delta: model.model, finishReason: null };
    yield { delta: '', finishReason: 'stop' };
  }
}

const req = (modelKey: string): ModelInvocationRequest => ({
  modelKey,
  messages: [{ role: 'user', content: 'hi' }],
});

describe('AdapterModelInvoker (spec 004)', () => {
  it('resolves the model+provider and dispatches to the adapter for that provider type', async () => {
    const adapter = new RecordingAdapter();
    const invoker = new AdapterModelInvoker(makeConfigService(), [adapter]);

    const result = await invoker.invoke(req('worker.fast'));

    expect(result.content).toBe('answered by openai/gpt-4.1-mini');
    expect(adapter.invoked[0].key).toBe('worker.fast');
  });

  it('throws a normalized error for an unknown model key (before any stream byte)', async () => {
    const invoker = new AdapterModelInvoker(makeConfigService(), [
      new RecordingAdapter(),
    ]);

    await expect(invoker.invoke(req('does.not.exist'))).rejects.toBeInstanceOf(
      GatewayApiException,
    );
  });

  it('throws when no adapter is registered for the provider type', async () => {
    const invoker = new AdapterModelInvoker(makeConfigService(), [
      new RecordingAdapter(),
    ]);

    // orphan.model -> provider 'ghost' -> type 'unregistered-type' (no adapter)
    await expect(invoker.invoke(req('orphan.model'))).rejects.toBeInstanceOf(
      GatewayApiException,
    );
  });

  it('dispatches streaming through the resolved adapter', async () => {
    const adapter = new RecordingAdapter();
    const invoker = new AdapterModelInvoker(makeConfigService(), [adapter]);

    const deltas: string[] = [];
    for await (const chunk of invoker.stream(req('worker.fast'))) {
      if (chunk.finishReason === null) deltas.push(chunk.delta);
    }

    expect(deltas.join('')).toBe('openai/gpt-4.1-mini');
  });
});
