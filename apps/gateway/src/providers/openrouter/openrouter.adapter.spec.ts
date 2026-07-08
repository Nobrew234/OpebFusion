import { ModelConfig, ProviderConfig } from '../../config/config.interfaces';
import { GatewayApiException } from '../../common/errors/gateway-api.exception';
import {
  ModelInvocationRequest,
  ModelStreamChunk,
} from '../model-invoker.interfaces';
import { OpenRouterAdapter } from './openrouter.adapter';
import {
  OpenRouterSdk,
  SdkGenerateOptions,
  SdkGenerateResult,
  SdkStreamResult,
} from './openrouter-sdk';

const model: ModelConfig = {
  key: 'worker.fast',
  provider: 'openrouter',
  model: 'openai/gpt-4.1-mini',
  role: 'delegate',
  capabilities: ['general'],
};

const provider: ProviderConfig = {
  name: 'openrouter',
  type: 'openrouter',
  apiKey: 'test-key',
  baseUrl: 'https://openrouter.ai/api/v1',
};

function request(
  overrides: Partial<ModelInvocationRequest> = {},
): ModelInvocationRequest {
  return {
    modelKey: 'worker.fast',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  };
}

class FakeOpenRouterSdk implements OpenRouterSdk {
  lastOptions?: SdkGenerateOptions;
  createdModelId?: string;

  constructor(
    private readonly generateResult: SdkGenerateResult = {
      text: 'hi there',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    },
    private readonly generateError?: Error,
    private readonly streamResult?: SdkStreamResult,
  ) {}

  createModel(_provider: ProviderConfig, modelId: string): unknown {
    this.createdModelId = modelId;
    return { id: modelId };
  }

  generate(options: SdkGenerateOptions): Promise<SdkGenerateResult> {
    this.lastOptions = options;
    if (this.generateError) {
      return Promise.reject(this.generateError);
    }
    return Promise.resolve(this.generateResult);
  }

  stream(options: SdkGenerateOptions): SdkStreamResult {
    this.lastOptions = options;
    if (this.streamResult) {
      return this.streamResult;
    }
    return {
      // eslint-disable-next-line @typescript-eslint/require-await
      textStream: (async function* () {
        yield 'hi ';
        yield 'there';
      })(),
      finishReason: Promise.resolve('stop'),
      usage: Promise.resolve({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      }),
    };
  }
}

describe('OpenRouterAdapter (spec 004)', () => {
  describe('invoke (non-streaming)', () => {
    it('builds the provider model from the config model id and returns normalized content/usage', async () => {
      const sdk = new FakeOpenRouterSdk();
      const adapter = new OpenRouterAdapter(sdk);

      const result = await adapter.invoke(model, provider, request());

      expect(sdk.createdModelId).toBe('openai/gpt-4.1-mini');
      expect(result.content).toBe('hi there');
      expect(result.finishReason).toBe('stop');
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
    });

    it('maps SDK tool calls into neutral ModelToolCalls', async () => {
      const sdk = new FakeOpenRouterSdk({
        text: '',
        toolCalls: [
          {
            toolCallId: 'call_1',
            toolName: 'delegate_llm',
            input: { target_model: 'worker.fast', task: 'draft' },
          },
        ],
        finishReason: 'tool-calls',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      });
      const adapter = new OpenRouterAdapter(sdk);

      const result = await adapter.invoke(model, provider, request());

      expect(result.finishReason).toBe('tool_calls');
      expect(result.toolCalls).toEqual([
        {
          id: 'call_1',
          name: 'delegate_llm',
          arguments: { target_model: 'worker.fast', task: 'draft' },
        },
      ]);
    });

    it('passes tools, temperature and stop through to the SDK', async () => {
      const sdk = new FakeOpenRouterSdk();
      const adapter = new OpenRouterAdapter(sdk);

      await adapter.invoke(
        model,
        provider,
        request({
          temperature: 0.4,
          stop: 'END',
          tools: [
            {
              name: 'delegate_llm',
              description: 'internal',
              parameters: { type: 'object' },
            },
          ],
        }),
      );

      expect(sdk.lastOptions?.temperature).toBe(0.4);
      expect(sdk.lastOptions?.stopSequences).toEqual(['END']);
      expect(sdk.lastOptions?.tools?.delegate_llm.description).toBe('internal');
    });

    it('maps an assistant tool-call message and a tool-result message to SDK parts', async () => {
      const sdk = new FakeOpenRouterSdk();
      const adapter = new OpenRouterAdapter(sdk);

      await adapter.invoke(
        model,
        provider,
        request({
          messages: [
            { role: 'user', content: 'do it' },
            {
              role: 'assistant',
              content: '',
              toolCalls: [
                { id: 'c1', name: 'delegate_llm', arguments: { task: 'x' } },
              ],
            },
            {
              role: 'tool',
              name: 'delegate_llm',
              toolCallId: 'c1',
              content: 'the result',
            },
          ],
        }),
      );

      const messages = sdk.lastOptions?.messages ?? [];
      const assistant = messages.find((m) => m.role === 'assistant');
      const toolMessage = messages.find((m) => m.role === 'tool');
      expect(assistant?.content).toEqual([
        {
          type: 'tool-call',
          toolCallId: 'c1',
          toolName: 'delegate_llm',
          input: { task: 'x' },
        },
      ]);
      expect(toolMessage?.content).toEqual([
        {
          type: 'tool-result',
          toolCallId: 'c1',
          toolName: 'delegate_llm',
          output: { type: 'text', value: 'the result' },
        },
      ]);
    });
  });

  describe('error normalization', () => {
    it('maps a 429 to a rate_limit error without leaking the raw message', async () => {
      const raw = Object.assign(new Error('sk-secret leaked upstream detail'), {
        statusCode: 429,
      });
      const adapter = new OpenRouterAdapter(
        new FakeOpenRouterSdk(undefined, raw),
      );

      await expect(adapter.invoke(model, provider, request())).rejects.toThrow(
        GatewayApiException,
      );
      try {
        await adapter.invoke(model, provider, request());
      } catch (err) {
        const gateway = err as GatewayApiException;
        expect(gateway.getStatus()).toBe(429);
        expect(JSON.stringify(gateway.getResponse())).not.toContain(
          'sk-secret',
        );
      }
    });

    it('maps a 5xx to provider_unavailable (503)', async () => {
      const raw = Object.assign(new Error('upstream down'), {
        statusCode: 503,
      });
      const adapter = new OpenRouterAdapter(
        new FakeOpenRouterSdk(undefined, raw),
      );

      try {
        await adapter.invoke(model, provider, request());
        fail('expected rejection');
      } catch (err) {
        expect((err as GatewayApiException).getStatus()).toBe(503);
      }
    });

    it('maps an abort/timeout error to a 408 timeout', async () => {
      const raw = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
      const adapter = new OpenRouterAdapter(
        new FakeOpenRouterSdk(undefined, raw),
      );

      try {
        await adapter.invoke(model, provider, request());
        fail('expected rejection');
      } catch (err) {
        expect((err as GatewayApiException).getStatus()).toBe(408);
      }
    });

    it('maps an unclassified provider error to provider_error (502)', async () => {
      const adapter = new OpenRouterAdapter(
        new FakeOpenRouterSdk(undefined, new Error('boom')),
      );

      try {
        await adapter.invoke(model, provider, request());
        fail('expected rejection');
      } catch (err) {
        expect((err as GatewayApiException).getStatus()).toBe(502);
      }
    });
  });

  describe('stream', () => {
    it('yields content deltas then a terminal chunk with finishReason and usage', async () => {
      const sdk = new FakeOpenRouterSdk();
      const adapter = new OpenRouterAdapter(sdk);

      const chunks: ModelStreamChunk[] = [];
      for await (const chunk of adapter.stream(model, provider, request())) {
        chunks.push(chunk);
      }

      const content = chunks
        .filter((c) => c.finishReason === null)
        .map((c) => c.delta)
        .join('');
      const terminal = chunks[chunks.length - 1];
      expect(content).toBe('hi there');
      expect(terminal.finishReason).toBe('stop');
      expect(terminal.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
    });
  });
});
