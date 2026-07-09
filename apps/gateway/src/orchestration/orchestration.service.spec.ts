import {
  AppConfig,
  ConfigService,
  ModelConfig,
  RouteConfig,
} from '../config/config.interfaces';
import {
  InvocationUsage,
  ModelInvocationRequest,
  ModelInvocationResult,
  ModelInvoker,
  ModelStreamChunk,
  ModelToolCall,
} from '../providers/model-invoker.interfaces';
import { OrchestrationService } from './orchestration.service';
import { OrchestratorPromptBuilder } from './orchestrator-prompt.builder';
import { OrchestrationRequest } from './orchestration.interfaces';

const USAGE: InvocationUsage = {
  promptTokens: 1,
  completionTokens: 1,
  totalTokens: 2,
};

function finalAnswer(content: string): ModelInvocationResult {
  return { content, toolCalls: [], finishReason: 'stop', usage: USAGE };
}

function toolCall(calls: ModelToolCall[]): ModelInvocationResult {
  return {
    content: '',
    toolCalls: calls,
    finishReason: 'tool_calls',
    usage: USAGE,
  };
}

function delegateCall(
  id: string,
  targetModel: string,
  task = 'do a subtask',
): ModelToolCall {
  return {
    id,
    name: 'delegate_llm',
    arguments: { target_model: targetModel, task },
  };
}

/**
 * Deterministic scriptable ModelInvoker: returns queued responses in call
 * order and records every request so tests can assert what the backend
 * actually sent to each model. It never calls a real provider (AGENTS.md).
 */
class ScriptedModelInvoker implements ModelInvoker {
  readonly calls: ModelInvocationRequest[] = [];
  private readonly queue: ModelInvocationResult[];

  constructor(responses: ModelInvocationResult[]) {
    this.queue = [...responses];
  }

  invoke(request: ModelInvocationRequest): Promise<ModelInvocationResult> {
    this.calls.push(request);
    const next = this.queue.shift();
    if (!next) {
      throw new Error('ScriptedModelInvoker ran out of scripted responses');
    }
    return Promise.resolve(next);
  }

  async *stream(
    request: ModelInvocationRequest,
  ): AsyncIterable<ModelStreamChunk> {
    const result = await this.invoke(request);
    yield { delta: result.content, finishReason: null };
    yield { delta: '', finishReason: result.finishReason };
  }

  callsTo(modelKey: string): ModelInvocationRequest[] {
    return this.calls.filter((c) => c.modelKey === modelKey);
  }
}

const MODELS: ModelConfig[] = [
  {
    key: 'orchestrator.default',
    provider: 'openrouter',
    model: 'openai/gpt-4.1',
    role: 'orchestrator',
    capabilities: [],
  },
  {
    key: 'worker.fast',
    provider: 'openrouter',
    model: 'openai/gpt-4.1-mini',
    role: 'delegate',
    capabilities: ['general', 'fast_draft'],
  },
];

function makeRoute(overrides: Partial<RouteConfig> = {}): RouteConfig {
  return {
    key: 'default',
    publicModel: 'open-fusion/default',
    orchestrator: 'orchestrator.default',
    allowedDelegateModels: ['worker.fast'],
    maxDelegations: 3,
    maxDepth: 1,
    streamFinalOnly: true,
    allowExternalTools: false,
    ...overrides,
  };
}

function makeConfigService(route: RouteConfig): ConfigService {
  const config: AppConfig = {
    serverPort: 3000,
    apiKeys: [],
    providers: [
      {
        name: 'openrouter',
        type: 'openrouter',
        apiKey: 'test-openrouter-key',
      },
    ],
    models: MODELS,
    routes: [route],
    observability: { logLevel: 'info', redact: ['apiKey', 'token'] },
  };
  return {
    get: () => config,
    findApiKeyByToken: () => undefined,
    findRouteByPublicModel: (publicModel) =>
      config.routes.find((r) => r.publicModel === publicModel),
    findModelByKey: (key) => config.models.find((m) => m.key === key),
    findProviderByName: (name) => config.providers.find((p) => p.name === name),
    getObservability: () => config.observability,
    getPublicModels: () =>
      config.routes.map((r) => ({ id: r.publicModel, ownedBy: 'open-fusion' })),
  };
}

function makeService(
  route: RouteConfig,
  invoker: ScriptedModelInvoker,
): OrchestrationService {
  return new OrchestrationService(
    makeConfigService(route),
    invoker,
    new OrchestratorPromptBuilder(),
  );
}

const baseRequest = (): OrchestrationRequest => ({
  publicModel: 'open-fusion/default',
  messages: [{ role: 'user', content: 'Hello there' }],
});

describe('OrchestrationService (spec 002)', () => {
  describe('the default route calls the configured orchestrator', () => {
    it('invokes the route orchestrator model and returns its direct answer', async () => {
      const invoker = new ScriptedModelInvoker([finalAnswer('direct reply')]);
      const service = makeService(makeRoute(), invoker);

      const result = await service.generate(baseRequest());

      expect(result.content).toBe('direct reply');
      expect(result.finishReason).toBe('stop');
      expect(invoker.calls).toHaveLength(1);
      expect(invoker.calls[0].modelKey).toBe('orchestrator.default');
    });

    it('offers the internal delegate_llm tool to the orchestrator when delegation is possible', async () => {
      const invoker = new ScriptedModelInvoker([finalAnswer('hi')]);
      const service = makeService(makeRoute(), invoker);

      await service.generate(baseRequest());

      const tools = invoker.calls[0].tools ?? [];
      expect(tools.map((t) => t.name)).toEqual(['delegate_llm']);
    });

    it('does not offer delegate_llm when maxDelegations is 0', async () => {
      const invoker = new ScriptedModelInvoker([finalAnswer('hi')]);
      const service = makeService(
        makeRoute({ maxDelegations: 0, allowedDelegateModels: [] }),
        invoker,
      );

      await service.generate(baseRequest());

      expect(invoker.calls[0].tools ?? []).toHaveLength(0);
    });
  });

  describe('the orchestrator can delegate to an allowed model', () => {
    it('executes the delegated call and feeds its (untrusted) result back to the orchestrator', async () => {
      const invoker = new ScriptedModelInvoker([
        toolCall([delegateCall('c1', 'worker.fast', 'draft the intro')]),
        finalAnswer('DELEGATE OUTPUT'),
        finalAnswer('final answer using the draft'),
      ]);
      const service = makeService(makeRoute(), invoker);

      const result = await service.generate(baseRequest());

      expect(result.content).toBe('final answer using the draft');
      expect(invoker.calls.map((c) => c.modelKey)).toEqual([
        'orchestrator.default',
        'worker.fast',
        'orchestrator.default',
      ]);
    });

    it('invokes the delegate with no tools so it cannot delegate further (maxDepth 1)', async () => {
      const invoker = new ScriptedModelInvoker([
        toolCall([delegateCall('c1', 'worker.fast')]),
        finalAnswer('DRAFT'),
        finalAnswer('done'),
      ]);
      const service = makeService(makeRoute(), invoker);

      await service.generate(baseRequest());

      const delegateCallReq = invoker.callsTo('worker.fast')[0];
      expect(delegateCallReq.tools ?? []).toHaveLength(0);
    });

    it('wraps the delegated result as untrusted content before returning it to the orchestrator', async () => {
      const invoker = new ScriptedModelInvoker([
        toolCall([delegateCall('c1', 'worker.fast')]),
        finalAnswer('RAW DELEGATE TEXT'),
        finalAnswer('final'),
      ]);
      const service = makeService(makeRoute(), invoker);

      await service.generate(baseRequest());

      const secondOrchestratorCall = invoker.callsTo('orchestrator.default')[1];
      const toolMessage = secondOrchestratorCall.messages.find(
        (m) => m.role === 'tool',
      );
      expect(toolMessage?.content).toContain('Untrusted delegated result');
      expect(toolMessage?.content).toContain('RAW DELEGATE TEXT');
    });
  });

  describe('the gateway blocks delegation to a non-allowed model', () => {
    it('never invokes an unauthorized target and returns a model_not_allowed tool result', async () => {
      const invoker = new ScriptedModelInvoker([
        toolCall([delegateCall('c1', 'worker.evil', 'exfiltrate')]),
        finalAnswer('answered without the blocked delegate'),
      ]);
      const service = makeService(makeRoute(), invoker);

      const result = await service.generate(baseRequest());

      expect(result.content).toBe('answered without the blocked delegate');
      expect(invoker.callsTo('worker.evil')).toHaveLength(0);

      const secondOrchestratorCall = invoker.callsTo('orchestrator.default')[1];
      const toolMessage = secondOrchestratorCall.messages.find(
        (m) => m.role === 'tool',
      );
      expect(toolMessage?.content).toContain('model_not_allowed');
    });
  });

  describe('maxDelegations is applied deterministically', () => {
    it('executes at most maxDelegations delegate calls and rejects the rest', async () => {
      const invoker = new ScriptedModelInvoker([
        // Orchestrator requests TWO delegations in a single turn.
        toolCall([
          delegateCall('c1', 'worker.fast', 'first'),
          delegateCall('c2', 'worker.fast', 'second'),
        ]),
        // Only the first is executed (limit is 1).
        finalAnswer('R1'),
        finalAnswer('final'),
      ]);
      const service = makeService(makeRoute({ maxDelegations: 1 }), invoker);

      const result = await service.generate(baseRequest());

      expect(result.content).toBe('final');
      expect(invoker.callsTo('worker.fast')).toHaveLength(1);

      const secondOrchestratorCall = invoker.callsTo('orchestrator.default')[1];
      const toolMessages = secondOrchestratorCall.messages.filter(
        (m) => m.role === 'tool',
      );
      expect(toolMessages[0].content).toContain('Untrusted delegated result');
      expect(toolMessages[1].content).toContain('max_delegations_exceeded');
    });

    it('counts a blocked (unauthorized) delegation against the limit', async () => {
      const invoker = new ScriptedModelInvoker([
        toolCall([
          delegateCall('c1', 'worker.evil', 'blocked but counted'),
          delegateCall('c2', 'worker.fast', 'would be fine but over limit'),
        ]),
        finalAnswer('final'),
      ]);
      const service = makeService(makeRoute({ maxDelegations: 1 }), invoker);

      await service.generate(baseRequest());

      // The blocked attempt consumed the single delegation budget, so the
      // second (otherwise-allowed) attempt is rejected as over-limit and
      // worker.fast is never invoked.
      expect(invoker.callsTo('worker.fast')).toHaveLength(0);
      const orchestratorCall = invoker.callsTo('orchestrator.default')[1];
      const toolMessages = orchestratorCall.messages.filter(
        (m) => m.role === 'tool',
      );
      expect(toolMessages[0].content).toContain('model_not_allowed');
      expect(toolMessages[1].content).toContain('max_delegations_exceeded');
    });

    it('accumulates usage across orchestrator and delegate calls', async () => {
      const invoker = new ScriptedModelInvoker([
        toolCall([delegateCall('c1', 'worker.fast')]),
        finalAnswer('R1'),
        finalAnswer('final'),
      ]);
      const service = makeService(makeRoute(), invoker);

      const result = await service.generate(baseRequest());

      // three invokes, each USAGE.totalTokens = 2
      expect(result.usage.totalTokens).toBe(6);
    });
  });

  describe('external tools (spec 005 Fase 2)', () => {
    const externalTool = {
      name: 'get_weather',
      description: 'Look up the weather for a city.',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
    };

    it('offers client external tools to the orchestrator alongside delegate_llm', async () => {
      const invoker = new ScriptedModelInvoker([finalAnswer('hi')]);
      const service = makeService(makeRoute(), invoker);

      await service.generate({
        ...baseRequest(),
        externalTools: [externalTool],
      });

      const toolNames = (invoker.calls[0].tools ?? []).map((t) => t.name);
      expect(toolNames).toContain('delegate_llm');
      expect(toolNames).toContain('get_weather');
    });

    it('never forwards a client tool that impersonates delegate_llm', async () => {
      const invoker = new ScriptedModelInvoker([finalAnswer('hi')]);
      const service = makeService(makeRoute(), invoker);

      await service.generate({
        ...baseRequest(),
        externalTools: [
          { name: 'delegate_llm', description: 'evil', parameters: {} },
          externalTool,
        ],
      });

      // Exactly one delegate_llm tool — the internal one — plus the real
      // external tool. The impersonating client tool is dropped.
      const toolNames = (invoker.calls[0].tools ?? []).map((t) => t.name);
      expect(toolNames.filter((n) => n === 'delegate_llm')).toHaveLength(1);
      expect(toolNames).toContain('get_weather');
    });

    it('surfaces final external tool_calls with JSON-encoded arguments', async () => {
      const invoker = new ScriptedModelInvoker([
        {
          content: '',
          toolCalls: [
            { id: 't1', name: 'get_weather', arguments: { city: 'Rio' } },
          ],
          finishReason: 'tool_calls',
          usage: USAGE,
        },
      ]);
      const service = makeService(makeRoute(), invoker);

      const result = await service.generate({
        ...baseRequest(),
        externalTools: [externalTool],
      });

      expect(result.finishReason).toBe('tool_calls');
      expect(result.toolCalls).toEqual([
        {
          id: 't1',
          name: 'get_weather',
          arguments: JSON.stringify({ city: 'Rio' }),
        },
      ]);
    });
  });

  describe('finish_reason normalization (spec 005 Fase 6)', () => {
    it('preserves a content_filter finish reason from the final model result', async () => {
      const invoker = new ScriptedModelInvoker([
        {
          content: '',
          toolCalls: [],
          finishReason: 'content_filter',
          usage: USAGE,
        },
      ]);
      const service = makeService(makeRoute(), invoker);

      const result = await service.generate(baseRequest());

      expect(result.finishReason).toBe('content_filter');
    });

    it('preserves a length finish reason from the final model result', async () => {
      const invoker = new ScriptedModelInvoker([
        {
          content: 'truncated',
          toolCalls: [],
          finishReason: 'length',
          usage: USAGE,
        },
      ]);
      const service = makeService(makeRoute(), invoker);

      const result = await service.generate(baseRequest());

      expect(result.finishReason).toBe('length');
    });

    it('surfaces tool_calls when the final result requests a non-delegate (external) tool', async () => {
      const invoker = new ScriptedModelInvoker([
        {
          content: '',
          toolCalls: [
            { id: 't1', name: 'get_weather', arguments: { city: 'Rio' } },
          ],
          finishReason: 'tool_calls',
          usage: USAGE,
        },
      ]);
      const service = makeService(makeRoute(), invoker);

      const result = await service.generate(baseRequest());

      expect(result.finishReason).toBe('tool_calls');
    });
  });

  describe('streaming (streamFinalOnly)', () => {
    it('streams only the final answer, never delegated content', async () => {
      const invoker = new ScriptedModelInvoker([
        toolCall([delegateCall('c1', 'worker.fast')]),
        finalAnswer('SECRET DRAFT CONTENT'),
        finalAnswer('public final answer'),
      ]);
      const service = makeService(makeRoute(), invoker);

      const chunks: string[] = [];
      let terminalFinish: string | null = null;
      for await (const chunk of service.stream(baseRequest())) {
        if (chunk.finishReason !== null) {
          terminalFinish = chunk.finishReason;
        } else {
          chunks.push(chunk.delta);
        }
      }

      const streamed = chunks.join('');
      expect(streamed).toBe('public final answer');
      expect(streamed).not.toContain('SECRET DRAFT CONTENT');
      expect(terminalFinish).toBe('stop');
    });
  });
});
