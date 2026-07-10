/**
 * Secret sanitization for structured logging (spec 006, "Sanitizacao
 * obrigatoria"). Every log entry passes through here BEFORE serialization, so
 * a secret can never reach disk on any branch — including entries built from
 * an `exception.message` or `exception.stack`, which routinely embed a
 * provider URL with a token in the query, a fragment of the `Authorization`
 * header, or the user's prompt.
 *
 * Two layers, applied in order:
 *   1. Known-value redaction — exact resolved secrets (provider apiKeys, client
 *      tokens) registered at boot via {@link setKnownSecrets}. This is the
 *      strongest defense: it does not rely on a secret "looking like" a secret.
 *   2. Pattern redaction — generic shapes (bearer tokens, `sk-...` keys,
 *      `Authorization`/`api_key` assignments, URL credential params) that catch
 *      secrets we were never told about.
 *
 * Pure and allocation-light: a record with no string leaves returns quickly.
 */

const REDACTED = '[REDACTED]';

/**
 * Exact secret values to strip wherever they appear, registered at boot. Kept
 * module-level so the free `appendLog` path can reach them without threading
 * config through every call site. Only values of a meaningful length are kept
 * to avoid redacting incidental short strings.
 */
let knownSecrets: string[] = [];

export function setKnownSecrets(values: Array<string | undefined>): void {
  knownSecrets = Array.from(
    new Set(
      values.filter((v): v is string => typeof v === 'string' && v.length >= 8),
    ),
  ).sort((a, b) => b.length - a.length); // longest first: avoid partial masks
}

/** Test/reset hook. */
export function clearKnownSecrets(): void {
  knownSecrets = [];
}

/**
 * Generic secret shapes. Each entry replaces the secret portion with
 * `[REDACTED]` while preserving any structural prefix (`Bearer `, key name)
 * so the redacted line stays readable and greppable.
 */
const PATTERNS: Array<{ re: RegExp; replace: string }> = [
  // `Authorization: Bearer xxx` / `"authorization":"Basic xxx"` / raw value.
  // The optional scheme word (Bearer/Basic/...) is preserved; the credential
  // that follows it is redacted.
  {
    re: /("?authorization"?\s*[:=]\s*"?)([A-Za-z]+\s+)?[A-Za-z0-9._+/=-]+/gi,
    replace: `$1$2${REDACTED}`,
  },
  // A bearer token anywhere else.
  { re: /\bBearer\s+[A-Za-z0-9._+/=-]+/gi, replace: `Bearer ${REDACTED}` },
  // OpenAI / OpenRouter style keys: `sk-...`, `sk-or-v1-...`.
  { re: /\bsk-[A-Za-z0-9._-]{6,}/gi, replace: `sk-${REDACTED}` },
  // `apiKey=xxx`, `"api_key":"xxx"`, `x-api-key: xxx`.
  {
    re: /("?(?:x-)?api[_-]?key"?\s*[:=]\s*"?)[A-Za-z0-9._+/=-]+/gi,
    replace: `$1${REDACTED}`,
  },
  // Credential-bearing URL query params: `?token=`, `&api_key=`, `access_token=`.
  {
    re: /([?&](?:api[_-]?key|access_token|token|key)=)[^&\s"']+/gi,
    replace: `$1${REDACTED}`,
  },
];

/**
 * Redacts secrets from a single string. Known values first (exact), then the
 * generic patterns. Safe on any input length; returns the input unchanged when
 * nothing matches.
 */
export function sanitizeString(input: string): string {
  let out = input;
  for (const secret of knownSecrets) {
    if (out.includes(secret)) {
      out = out.split(secret).join(REDACTED);
    }
  }
  for (const { re, replace } of PATTERNS) {
    out = out.replace(re, replace);
  }
  return out;
}

/**
 * Deep-sanitizes every string leaf of a log record (keys are structural and
 * left intact). Applied to the whole record before serialization so `message`,
 * `stack`, and any client-controlled field (`path`, `model`) are all covered
 * in one pass. Never mutates its input.
 */
export function sanitizeLogFields<T>(value: T): T {
  return sanitizeValue(value) as T;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeString(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = sanitizeValue(entry);
    }
    return result;
  }
  return value;
}
