import { redactSecrets } from './redaction';

describe('redactSecrets', () => {
  const redactKeys = ['apiKey', 'token', 'authorization'];

  it('redacts matching keys anywhere in a nested structure', () => {
    const input = {
      providers: [{ name: 'openrouter', apiKey: 'sk-super-secret' }],
      auth: { apiKeys: [{ id: 'k1', token: 'bearer-secret' }] },
      server: { port: 3000 },
    };

    const output = redactSecrets(input, redactKeys);

    expect(output).toEqual({
      providers: [{ name: 'openrouter', apiKey: '[REDACTED]' }],
      auth: { apiKeys: [{ id: 'k1', token: '[REDACTED]' }] },
      server: { port: 3000 },
    });
  });

  it('matches key names case-insensitively', () => {
    const output = redactSecrets(
      { Authorization: 'Bearer abc', ApiKey: 'sk-1' },
      redactKeys,
    );
    expect(output).toEqual({
      Authorization: '[REDACTED]',
      ApiKey: '[REDACTED]',
    });
  });

  it('never mutates the input', () => {
    const input = { apiKey: 'sk-secret' };
    const output = redactSecrets(input, redactKeys);
    expect(input.apiKey).toBe('sk-secret');
    expect(output).not.toBe(input);
  });

  it('guarantees the resolved secret value does not survive serialization', () => {
    const secret = 'sk-do-not-leak-this-value';
    const serialized = JSON.stringify(
      redactSecrets({ providers: [{ apiKey: secret }] }, redactKeys),
    );
    expect(serialized).not.toContain(secret);
  });

  it('leaves non-secret primitives untouched', () => {
    expect(redactSecrets('plain', redactKeys)).toBe('plain');
    expect(redactSecrets(42, redactKeys)).toBe(42);
    expect(redactSecrets(null, redactKeys)).toBeNull();
  });
});
