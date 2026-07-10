import {
  clearKnownSecrets,
  sanitizeLogFields,
  sanitizeString,
  setKnownSecrets,
} from './sanitize';

describe('sanitize (spec 006 "Sanitizacao obrigatoria")', () => {
  afterEach(() => clearKnownSecrets());

  describe('pattern-based redaction', () => {
    it('redacts a bearer token', () => {
      expect(
        sanitizeString('Authorization: Bearer sk-abcdef123456'),
      ).not.toContain('sk-abcdef123456');
      expect(
        sanitizeString('call failed with Bearer abc.def.ghi token'),
      ).toContain('Bearer [REDACTED]');
    });

    it('redacts an OpenRouter/OpenAI style api key anywhere in the string', () => {
      const out = sanitizeString(
        'fetch https://openrouter.ai/api/v1 failed key=sk-or-v1-deadbeefdeadbeef',
      );
      expect(out).not.toContain('sk-or-v1-deadbeefdeadbeef');
      expect(out).toContain('[REDACTED]');
    });

    it('redacts an Authorization header value regardless of scheme', () => {
      const out = sanitizeString('"authorization":"Basic Zm9vOmJhcg=="');
      expect(out).not.toContain('Zm9vOmJhcg==');
    });

    it('redacts api_key assignments and x-api-key headers', () => {
      expect(sanitizeString('api_key=supersecretvalue123')).not.toContain(
        'supersecretvalue123',
      );
      expect(
        sanitizeString('"x-api-key": "another-secret-9999"'),
      ).not.toContain('another-secret-9999');
    });

    it('redacts credential query params in a URL', () => {
      const out = sanitizeString(
        'GET https://api.example.com/v1?model=x&token=abcTOKEN12345&foo=bar',
      );
      expect(out).not.toContain('abcTOKEN12345');
      expect(out).toContain('model=x'); // non-secret params survive
      expect(out).toContain('foo=bar');
    });

    it('leaves ordinary text untouched', () => {
      expect(sanitizeString('request completed in 42ms for model gpt-4')).toBe(
        'request completed in 42ms for model gpt-4',
      );
    });
  });

  describe('known-value redaction', () => {
    it('redacts an exact registered secret wherever it appears', () => {
      setKnownSecrets(['the-real-provider-secret-value']);
      const out = sanitizeString(
        'stack: Error at provider with the-real-provider-secret-value inside',
      );
      expect(out).not.toContain('the-real-provider-secret-value');
      expect(out).toContain('[REDACTED]');
    });

    it('ignores short/empty values to avoid over-redaction', () => {
      setKnownSecrets(['ab', '', undefined]);
      expect(sanitizeString('ab is a common fragment')).toBe(
        'ab is a common fragment',
      );
    });
  });

  describe('sanitizeLogFields', () => {
    it('deep-sanitizes every string leaf, keeping structure and keys', () => {
      setKnownSecrets(['registered-secret-abcdef']);
      const record = {
        requestId: 'req-1',
        status: 500,
        message: 'boom with registered-secret-abcdef',
        stack: 'Error\n at foo Bearer tok.en.value\n at bar',
        nested: { url: 'https://x/api?token=leakedtoken12345' },
        list: ['ok', 'sk-leakedkey123456'],
      };
      const out = sanitizeLogFields(record);

      const serialized = JSON.stringify(out);
      expect(serialized).not.toContain('registered-secret-abcdef');
      expect(serialized).not.toContain('tok.en.value');
      expect(serialized).not.toContain('leakedtoken12345');
      expect(serialized).not.toContain('sk-leakedkey123456');
      // Structure preserved.
      expect(out.requestId).toBe('req-1');
      expect(out.status).toBe(500);
    });

    it('does not mutate its input', () => {
      const record = { message: 'Bearer secrettoken123456' };
      sanitizeLogFields(record);
      expect(record.message).toBe('Bearer secrettoken123456');
    });
  });
});
