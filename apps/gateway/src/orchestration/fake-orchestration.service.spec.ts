import { FakeOrchestrationService } from './fake-orchestration.service';
import {
  OrchestrationChunk,
  OrchestrationRequest,
} from './orchestration.interfaces';

describe('FakeOrchestrationService', () => {
  let service: FakeOrchestrationService;

  beforeEach(() => {
    service = new FakeOrchestrationService();
  });

  const request: OrchestrationRequest = {
    publicModel: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'What is the capital of France?' },
    ],
  };

  describe('generate', () => {
    it('echoes the last user message deterministically', async () => {
      const result = await service.generate(request);
      expect(result.content).toBe('Echo: What is the capital of France?');
    });

    it('always returns finish_reason stop', async () => {
      const result = await service.generate(request);
      expect(result.finishReason).toBe('stop');
    });

    it('produces the same result across repeated calls (deterministic)', async () => {
      const first = await service.generate(request);
      const second = await service.generate(request);
      expect(second).toEqual(first);
    });

    it('returns consistent usage numbers', async () => {
      const result = await service.generate(request);
      expect(result.usage.totalTokens).toBe(
        result.usage.promptTokens + result.usage.completionTokens,
      );
      expect(result.usage.promptTokens).toBeGreaterThan(0);
      expect(result.usage.completionTokens).toBeGreaterThan(0);
    });

    it('throws when there is no user message', async () => {
      const noUserRequest: OrchestrationRequest = {
        publicModel: 'gpt-4o',
        messages: [{ role: 'system', content: 'You are helpful.' }],
      };
      await expect(service.generate(noUserRequest)).rejects.toThrow();
    });
  });

  describe('stream', () => {
    async function collectChunks(req: OrchestrationRequest) {
      const chunks: OrchestrationChunk[] = [];
      for await (const chunk of service.stream(req)) {
        chunks.push(chunk);
      }
      return chunks;
    }

    it('yields deltas that concatenate to the same content as generate()', async () => {
      const generated = await service.generate(request);
      const chunks = await collectChunks(request);
      const concatenated = chunks.map((c) => c.delta).join('');
      expect(concatenated).toBe(generated.content);
    });

    it('yields a terminal chunk with empty delta and a non-null finish_reason', async () => {
      const chunks = await collectChunks(request);
      const terminal = chunks[chunks.length - 1];
      expect(terminal.delta).toBe('');
      expect(terminal.finishReason).toBe('stop');
    });

    it('has null finish_reason on every chunk except the terminal one', async () => {
      const chunks = await collectChunks(request);
      const nonTerminal = chunks.slice(0, -1);
      expect(nonTerminal.every((c) => c.finishReason === null)).toBe(true);
    });

    it('yields more than one chunk', async () => {
      const chunks = await collectChunks(request);
      expect(chunks.length).toBeGreaterThan(1);
    });
  });
});
