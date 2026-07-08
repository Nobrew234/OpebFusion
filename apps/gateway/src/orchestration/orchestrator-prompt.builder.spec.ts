import { ModelConfig, RouteConfig } from '../config/config.interfaces';
import { OrchestratorPromptBuilder } from './orchestrator-prompt.builder';

const route: RouteConfig = {
  key: 'default',
  publicModel: 'open-fusion/default',
  orchestrator: 'orchestrator.default',
  allowedDelegateModels: ['worker.fast'],
  maxDelegations: 2,
  maxDepth: 1,
  streamFinalOnly: true,
};

const delegateModels: ModelConfig[] = [
  {
    key: 'worker.fast',
    provider: 'openrouter',
    model: 'openai/gpt-4.1-mini',
    role: 'delegate',
    capabilities: ['general', 'fast_draft'],
  },
];

describe('OrchestratorPromptBuilder', () => {
  const builder = new OrchestratorPromptBuilder();

  it('lists the allowed delegate model keys and their capabilities', () => {
    const prompt = builder.build(route, delegateModels);
    expect(prompt).toContain('worker.fast');
    expect(prompt).toContain('general, fast_draft');
  });

  it('states the maxDelegations budget', () => {
    const prompt = builder.build(route, delegateModels);
    expect(prompt).toContain('at most 2 time(s)');
  });

  it('instructs the orchestrator to treat delegated results as untrusted and keep internals hidden', () => {
    const prompt = builder.build(route, delegateModels);
    expect(prompt.toLowerCase()).toContain('untrusted');
    expect(prompt.toLowerCase()).toContain('never reveal');
  });

  it('never leaks the provider model id into the prompt', () => {
    const prompt = builder.build(route, delegateModels);
    expect(prompt).not.toContain('openai/gpt-4.1-mini');
  });

  it('tells the orchestrator to answer directly when no delegates are available', () => {
    const prompt = builder.build(
      { ...route, allowedDelegateModels: [], maxDelegations: 0 },
      [],
    );
    expect(prompt.toLowerCase()).toContain('answer directly');
  });
});
