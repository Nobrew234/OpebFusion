import {
  DELEGATE_LLM_TOOL_NAME,
  delegateLlmToolSpec,
  parseDelegateArgs,
} from './delegate-llm.tool';

describe('delegate_llm tool', () => {
  describe('delegateLlmToolSpec', () => {
    it('names the internal tool and requires target_model and task', () => {
      const spec = delegateLlmToolSpec(['worker.fast']);
      expect(spec.name).toBe(DELEGATE_LLM_TOOL_NAME);
      expect(spec.parameters.required).toEqual(['target_model', 'task']);
    });

    it('constrains target_model to the allowed models via enum', () => {
      const spec = delegateLlmToolSpec(['worker.fast', 'worker.slow']);
      const properties = spec.parameters.properties as Record<
        string,
        { enum?: string[] }
      >;
      expect(properties.target_model.enum).toEqual([
        'worker.fast',
        'worker.slow',
      ]);
    });

    it('omits the enum when there are no allowed models', () => {
      const spec = delegateLlmToolSpec([]);
      const properties = spec.parameters.properties as Record<
        string,
        { enum?: string[] }
      >;
      expect(properties.target_model.enum).toBeUndefined();
    });
  });

  describe('parseDelegateArgs', () => {
    it('accepts a minimal valid call', () => {
      const result = parseDelegateArgs({
        target_model: 'worker.fast',
        task: 'draft',
      });
      expect(result).toEqual({
        ok: true,
        args: { target_model: 'worker.fast', task: 'draft' },
      });
    });

    it('rejects a missing target_model', () => {
      const result = parseDelegateArgs({ task: 'draft' });
      expect(result.ok).toBe(false);
    });

    it('rejects a missing task', () => {
      const result = parseDelegateArgs({ target_model: 'worker.fast' });
      expect(result.ok).toBe(false);
    });

    it('rejects malformed messages', () => {
      const result = parseDelegateArgs({
        target_model: 'worker.fast',
        task: 'draft',
        messages: [{ role: 'user' }],
      });
      expect(result.ok).toBe(false);
    });

    it('keeps optional output_contract and reason when present', () => {
      const result = parseDelegateArgs({
        target_model: 'worker.fast',
        task: 'draft',
        output_contract: 'json',
        reason: 'faster',
      });
      expect(result).toEqual({
        ok: true,
        args: {
          target_model: 'worker.fast',
          task: 'draft',
          output_contract: 'json',
          reason: 'faster',
        },
      });
    });
  });
});
