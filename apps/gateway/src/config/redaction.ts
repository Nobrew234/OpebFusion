const REDACTED = '[REDACTED]';

/**
 * Deep-copies `value`, replacing the value of any object key whose name
 * case-insensitively matches an entry in `redactKeys` with `[REDACTED]`. Used
 * to make config (and any other structure that may carry a resolved secret)
 * safe to serialize into logs — spec 003 requires that a resolved `*Env`
 * secret never appears in logs, errors, or responses (see also spec 007).
 *
 * Matching is by key name, not value, so it is robust even when the same
 * secret also appears under an unexpected key: add that key to `redactKeys`.
 * The function is pure and never mutates its input.
 */
export function redactSecrets<T>(value: T, redactKeys: string[]): T {
  const lowered = new Set(redactKeys.map((key) => key.toLowerCase()));
  return redactValue(value, lowered) as T;
}

function redactValue(value: unknown, redactKeys: Set<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, redactKeys));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = redactKeys.has(key.toLowerCase())
        ? REDACTED
        : redactValue(entry, redactKeys);
    }
    return result;
  }
  return value;
}
