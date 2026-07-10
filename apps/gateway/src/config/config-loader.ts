import * as fs from 'fs';
import * as path from 'path';
import {
  ApiKeyConfig,
  AppConfig,
  LogLevel,
  ModelConfig,
  ModelRole,
  ObservabilityConfig,
  ProviderConfig,
  RouteConfig,
} from './config.interfaces';

const DEFAULT_CONFIG_RELATIVE_PATH = './config/open-fusion.config.json';

const MODEL_ROLES: ModelRole[] = ['orchestrator', 'delegate'];

/**
 * Provider `type` values the gateway can actually construct an adapter for.
 * OpenRouter is the only officially supported provider in the MVP (ADR 0006 /
 * spec 004); this enum is what makes "every provider needs a KNOWN type" a
 * boot-time contract. Adding a provider means registering its type here and in
 * the providers module (see openfusion-provider-adapter).
 */
const KNOWN_PROVIDER_TYPES = ['openrouter'];

/**
 * Closed vocabulary of model capabilities (spec 004's list, plus the
 * routing-specific plan/code/review/design set used by spec 006). Capabilities
 * are advisory metadata for orchestration; declaring one the provider can't
 * actually back up is a config author's mistake, but an *unknown* capability
 * string is a schema error we reject at boot.
 */
const KNOWN_CAPABILITIES = [
  'general',
  'reasoning',
  'coding',
  'long_context',
  'vision',
  'tool_calling',
  'json_mode',
  'fast_draft',
  'low_cost',
  'plan',
  'code',
  'review',
  'design',
];

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

const DEFAULT_REDACT = ['apiKey', 'token', 'authorization'];

/**
 * Permissive local-dev mode (spec 003: "salvo em modo de validacao permissivo
 * local"). When set, a provider secret whose env var is missing does not fail
 * boot — the provider is loaded with no `apiKey`, so the config can be
 * validated locally without every real credential present. It NEVER relaxes
 * client auth tokens (`tokenEnv`), which are required to serve any request.
 */
function isPermissiveSecretsMode(): boolean {
  const flag = process.env.OPEN_FUSION_ALLOW_MISSING_SECRETS;
  return flag === '1' || flag === 'true';
}

/**
 * Thrown for any problem found while loading/validating the Open Fusion
 * config file (missing file, invalid JSON, or a schema violation). The
 * message always names the offending field path (or 'config' for
 * file-level problems) and never includes a resolved secret value —
 * see AGENTS.md's "Segredos" invariant.
 */
export class ConfigLoadError extends Error {
  constructor(fieldPath: string, detail: string) {
    super(`Invalid Open Fusion configuration at '${fieldPath}': ${detail}`);
    this.name = 'ConfigLoadError';
  }
}

function resolveConfigPath(): string {
  const configuredPath = process.env.OPEN_FUSION_CONFIG;
  const target =
    configuredPath && configuredPath.trim().length > 0
      ? configuredPath
      : DEFAULT_CONFIG_RELATIVE_PATH;
  return path.isAbsolute(target) ? target : path.resolve(process.cwd(), target);
}

function readConfigFile(filePath: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new ConfigLoadError(
      'config',
      `could not read config file at '${filePath}': ${(err as Error).message}`,
    );
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new ConfigLoadError(
      'config',
      `config file at '${filePath}' is not valid JSON: ${(err as Error).message}`,
    );
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Validates an optional positive-integer limit field: absent is allowed, but
 * a present value must be a positive integer (spec 003 "limites de payload,
 * quantidade de mensagens e tamanho de conteudo devem ser inteiros positivos
 * quando configurados").
 */
function validateOptionalPositiveInteger(
  container: Record<string, unknown>,
  key: string,
  fieldPath: string,
): number | undefined {
  const value = container[key];
  if (value === undefined) {
    return undefined;
  }
  if (!isPositiveInteger(value)) {
    throw new ConfigLoadError(
      fieldPath,
      `must be a positive integer when set, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function validateVersion(raw: Record<string, unknown>): void {
  if (raw.version !== 1) {
    throw new ConfigLoadError(
      'version',
      `must be exactly 1, got ${JSON.stringify(raw.version)}`,
    );
  }
}

function validateServerPort(raw: Record<string, unknown>): number {
  const server = isPlainObject(raw.server) ? raw.server : {};
  const port = server.port;
  if (!isPositiveInteger(port)) {
    throw new ConfigLoadError(
      'server.port',
      `must be a positive integer, got ${JSON.stringify(port)}`,
    );
  }
  return port;
}

function validateApiKeys(raw: Record<string, unknown>): ApiKeyConfig[] {
  const auth = isPlainObject(raw.auth) ? raw.auth : {};
  const apiKeys = auth.apiKeys;
  if (!Array.isArray(apiKeys) || apiKeys.length === 0) {
    throw new ConfigLoadError('auth.apiKeys', 'must be a non-empty array');
  }

  return apiKeys.map((entry: unknown, index: number) => {
    const fieldPrefix = `auth.apiKeys[${index}]`;
    if (!isPlainObject(entry)) {
      throw new ConfigLoadError(fieldPrefix, 'must be an object');
    }
    if (!isNonEmptyString(entry.id)) {
      throw new ConfigLoadError(
        `${fieldPrefix}.id`,
        'must be a non-empty string',
      );
    }
    if (!isNonEmptyString(entry.tokenEnv)) {
      throw new ConfigLoadError(
        `${fieldPrefix}.tokenEnv`,
        'must be a non-empty string',
      );
    }
    const allowedRoutes = entry.allowedRoutes;
    if (
      !Array.isArray(allowedRoutes) ||
      !allowedRoutes.every((route) => typeof route === 'string')
    ) {
      throw new ConfigLoadError(
        `${fieldPrefix}.allowedRoutes`,
        'must be an array of strings',
      );
    }

    const tokenEnvName = entry.tokenEnv;
    const token = process.env[tokenEnvName];
    if (!token || token.trim().length === 0) {
      throw new ConfigLoadError(
        `${fieldPrefix}.tokenEnv`,
        `environment variable '${tokenEnvName}' referenced by tokenEnv is not set`,
      );
    }

    return {
      id: entry.id,
      token,
      allowedRoutes: allowedRoutes,
    };
  });
}

function validateProviders(raw: Record<string, unknown>): ProviderConfig[] {
  const providers = raw.providers;
  if (!isPlainObject(providers) || Object.keys(providers).length === 0) {
    throw new ConfigLoadError('providers', 'must be a non-empty object');
  }

  return Object.entries(providers).map(([name, value]) => {
    const fieldPrefix = `providers.${name}`;
    if (!isPlainObject(value)) {
      throw new ConfigLoadError(fieldPrefix, 'must be an object');
    }
    if (!isNonEmptyString(value.type)) {
      throw new ConfigLoadError(
        `${fieldPrefix}.type`,
        'must be a non-empty string',
      );
    }
    if (!KNOWN_PROVIDER_TYPES.includes(value.type)) {
      throw new ConfigLoadError(
        `${fieldPrefix}.type`,
        `must be one of ${KNOWN_PROVIDER_TYPES.map((t) => `'${t}'`).join(', ')}, got ${JSON.stringify(value.type)}`,
      );
    }
    if (!isNonEmptyString(value.apiKeyEnv)) {
      throw new ConfigLoadError(
        `${fieldPrefix}.apiKeyEnv`,
        'must be a non-empty string naming an environment variable',
      );
    }
    const apiKey = resolveProviderSecret(
      value.apiKeyEnv,
      `${fieldPrefix}.apiKeyEnv`,
    );
    if (value.baseUrl !== undefined && !isNonEmptyString(value.baseUrl)) {
      throw new ConfigLoadError(
        `${fieldPrefix}.baseUrl`,
        'must be a non-empty string when set',
      );
    }
    if (value.headers !== undefined && !isPlainObject(value.headers)) {
      throw new ConfigLoadError(
        `${fieldPrefix}.headers`,
        'must be an object when set',
      );
    }
    if (
      value.providerOptions !== undefined &&
      !isPlainObject(value.providerOptions)
    ) {
      throw new ConfigLoadError(
        `${fieldPrefix}.providerOptions`,
        'must be an object when set',
      );
    }

    return {
      name,
      type: value.type,
      ...(apiKey !== undefined ? { apiKey } : {}),
      ...(value.baseUrl !== undefined ? { baseUrl: value.baseUrl } : {}),
      ...(value.headers !== undefined
        ? { headers: value.headers as Record<string, string> }
        : {}),
      ...(value.providerOptions !== undefined
        ? { providerOptions: value.providerOptions }
        : {}),
    };
  });
}

/**
 * Resolves a provider secret referenced by `apiKeyEnv`. Returns the resolved
 * value, or `undefined` in permissive local-dev mode when the env var is
 * absent. Outside permissive mode a missing secret fails boot with a message
 * naming ONLY the env var name — never any already-resolved secret value.
 */
function resolveProviderSecret(
  apiKeyEnv: string,
  fieldPath: string,
): string | undefined {
  const secret = process.env[apiKeyEnv];
  if (secret && secret.trim().length > 0) {
    return secret;
  }
  if (isPermissiveSecretsMode()) {
    return undefined;
  }
  throw new ConfigLoadError(
    fieldPath,
    `environment variable '${apiKeyEnv}' referenced by apiKeyEnv is not set (set OPEN_FUSION_ALLOW_MISSING_SECRETS=1 for permissive local validation)`,
  );
}

function validateModels(
  raw: Record<string, unknown>,
  providers: ProviderConfig[],
): ModelConfig[] {
  const models = raw.models;
  if (!isPlainObject(models) || Object.keys(models).length === 0) {
    throw new ConfigLoadError('models', 'must be a non-empty object');
  }
  const providerNames = new Set(providers.map((p) => p.name));

  return Object.entries(models).map(([key, value]) => {
    const fieldPrefix = `models.${key}`;
    if (!isPlainObject(value)) {
      throw new ConfigLoadError(fieldPrefix, 'must be an object');
    }
    if (!isNonEmptyString(value.provider)) {
      throw new ConfigLoadError(
        `${fieldPrefix}.provider`,
        'must be a non-empty string',
      );
    }
    if (!providerNames.has(value.provider)) {
      throw new ConfigLoadError(
        `${fieldPrefix}.provider`,
        `references unknown provider '${value.provider}'`,
      );
    }
    if (!isNonEmptyString(value.model)) {
      throw new ConfigLoadError(
        `${fieldPrefix}.model`,
        'must be a non-empty string',
      );
    }
    if (!MODEL_ROLES.includes(value.role as ModelRole)) {
      throw new ConfigLoadError(
        `${fieldPrefix}.role`,
        `must be one of ${MODEL_ROLES.map((r) => `'${r}'`).join(', ')}, got ${JSON.stringify(value.role)}`,
      );
    }
    let capabilities: string[] = [];
    if (value.capabilities !== undefined) {
      if (
        !Array.isArray(value.capabilities) ||
        !value.capabilities.every((c) => typeof c === 'string')
      ) {
        throw new ConfigLoadError(
          `${fieldPrefix}.capabilities`,
          'must be an array of strings when set',
        );
      }
      value.capabilities.forEach((capability, index) => {
        if (!KNOWN_CAPABILITIES.includes(capability)) {
          throw new ConfigLoadError(
            `${fieldPrefix}.capabilities[${index}]`,
            `unknown capability ${JSON.stringify(capability)}; must be one of ${KNOWN_CAPABILITIES.map((c) => `'${c}'`).join(', ')}`,
          );
        }
      });
      capabilities = value.capabilities;
    }
    if (value.defaults !== undefined && !isPlainObject(value.defaults)) {
      throw new ConfigLoadError(
        `${fieldPrefix}.defaults`,
        'must be an object when set',
      );
    }

    return {
      key,
      provider: value.provider,
      model: value.model,
      role: value.role as ModelRole,
      capabilities,
      ...(value.defaults !== undefined ? { defaults: value.defaults } : {}),
    };
  });
}

function validateRoutes(
  raw: Record<string, unknown>,
  models: ModelConfig[],
): RouteConfig[] {
  const routes = raw.routes;
  if (!isPlainObject(routes) || Object.keys(routes).length === 0) {
    throw new ConfigLoadError('routes', 'must be a non-empty object');
  }

  const modelsByKey = new Map(models.map((m) => [m.key, m]));

  return Object.entries(routes).map(([key, value]) => {
    const fieldPrefix = `routes.${key}`;
    if (!isPlainObject(value)) {
      throw new ConfigLoadError(fieldPrefix, 'must be an object');
    }
    if (!isNonEmptyString(value.publicModel)) {
      throw new ConfigLoadError(
        `${fieldPrefix}.publicModel`,
        'must be a non-empty string',
      );
    }

    // orchestrator: must reference an existing model with role 'orchestrator'.
    if (!isNonEmptyString(value.orchestrator)) {
      throw new ConfigLoadError(
        `${fieldPrefix}.orchestrator`,
        'must be a non-empty string',
      );
    }
    const orchestratorModel = modelsByKey.get(value.orchestrator);
    if (!orchestratorModel) {
      throw new ConfigLoadError(
        `${fieldPrefix}.orchestrator`,
        `references unknown model '${value.orchestrator}'`,
      );
    }
    if (orchestratorModel.role !== 'orchestrator') {
      throw new ConfigLoadError(
        `${fieldPrefix}.orchestrator`,
        `references model '${value.orchestrator}' whose role is '${orchestratorModel.role}', expected 'orchestrator'`,
      );
    }

    // allowedDelegateModels: each must exist and have role 'delegate'.
    const allowedDelegateModels = value.allowedDelegateModels;
    if (
      !Array.isArray(allowedDelegateModels) ||
      !allowedDelegateModels.every((m) => typeof m === 'string')
    ) {
      throw new ConfigLoadError(
        `${fieldPrefix}.allowedDelegateModels`,
        'must be an array of strings',
      );
    }
    allowedDelegateModels.forEach((modelKey: string, index: number) => {
      const delegateModel = modelsByKey.get(modelKey);
      if (!delegateModel) {
        throw new ConfigLoadError(
          `${fieldPrefix}.allowedDelegateModels[${index}]`,
          `references unknown model '${modelKey}'`,
        );
      }
      if (delegateModel.role !== 'delegate') {
        throw new ConfigLoadError(
          `${fieldPrefix}.allowedDelegateModels[${index}]`,
          `references model '${modelKey}' whose role is '${delegateModel.role}', expected 'delegate'`,
        );
      }
    });

    // maxDelegations: non-negative integer.
    if (!isNonNegativeInteger(value.maxDelegations)) {
      throw new ConfigLoadError(
        `${fieldPrefix}.maxDelegations`,
        `must be a non-negative integer, got ${JSON.stringify(value.maxDelegations)}`,
      );
    }

    // maxDepth: must be exactly 1 in the MVP (hard architectural ceiling).
    if (value.maxDepth !== 1) {
      throw new ConfigLoadError(
        `${fieldPrefix}.maxDepth`,
        `must be exactly 1 in the MVP, got ${JSON.stringify(value.maxDepth)}`,
      );
    }

    const timeoutMs = validateOptionalPositiveInteger(
      value,
      'timeoutMs',
      `${fieldPrefix}.timeoutMs`,
    );
    const delegateTimeoutMs = validateOptionalPositiveInteger(
      value,
      'delegateTimeoutMs',
      `${fieldPrefix}.delegateTimeoutMs`,
    );
    const maxMessages = validateOptionalPositiveInteger(
      value,
      'maxMessages',
      `${fieldPrefix}.maxMessages`,
    );
    const maxMessageContentLength = validateOptionalPositiveInteger(
      value,
      'maxMessageContentLength',
      `${fieldPrefix}.maxMessageContentLength`,
    );
    const maxPayloadBytes = validateOptionalPositiveInteger(
      value,
      'maxPayloadBytes',
      `${fieldPrefix}.maxPayloadBytes`,
    );

    // streamFinalOnly: optional boolean, defaults to true (spec 002).
    let streamFinalOnly = true;
    if (value.streamFinalOnly !== undefined) {
      if (typeof value.streamFinalOnly !== 'boolean') {
        throw new ConfigLoadError(
          `${fieldPrefix}.streamFinalOnly`,
          `must be a boolean when set, got ${JSON.stringify(value.streamFinalOnly)}`,
        );
      }
      streamFinalOnly = value.streamFinalOnly;
    }

    // allowExternalTools: optional boolean, defaults to false (spec 005). A
    // route must opt in explicitly before client tools are forwarded.
    let allowExternalTools = false;
    if (value.allowExternalTools !== undefined) {
      if (typeof value.allowExternalTools !== 'boolean') {
        throw new ConfigLoadError(
          `${fieldPrefix}.allowExternalTools`,
          `must be a boolean when set, got ${JSON.stringify(value.allowExternalTools)}`,
        );
      }
      allowExternalTools = value.allowExternalTools;
    }

    return {
      key,
      publicModel: value.publicModel,
      orchestrator: value.orchestrator,
      allowedDelegateModels,
      maxDelegations: value.maxDelegations,
      maxDepth: value.maxDepth,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(delegateTimeoutMs !== undefined ? { delegateTimeoutMs } : {}),
      ...(maxMessages !== undefined ? { maxMessages } : {}),
      ...(maxMessageContentLength !== undefined
        ? { maxMessageContentLength }
        : {}),
      ...(maxPayloadBytes !== undefined ? { maxPayloadBytes } : {}),
      streamFinalOnly,
      allowExternalTools,
    };
  });
}

/**
 * Validates the optional `observability` section (spec 003 structure). Both
 * fields have safe defaults so the section can be omitted entirely, but a
 * present value must be valid: `logLevel` from a fixed vocabulary, `redact`
 * an array of key names to strip before logging.
 */
function validateObservability(
  raw: Record<string, unknown>,
): ObservabilityConfig {
  const observability = isPlainObject(raw.observability)
    ? raw.observability
    : {};

  let logLevel: LogLevel = 'info';
  if (observability.logLevel !== undefined) {
    if (!LOG_LEVELS.includes(observability.logLevel as LogLevel)) {
      throw new ConfigLoadError(
        'observability.logLevel',
        `must be one of ${LOG_LEVELS.map((l) => `'${l}'`).join(', ')}, got ${JSON.stringify(observability.logLevel)}`,
      );
    }
    logLevel = observability.logLevel as LogLevel;
  }

  let redact = [...DEFAULT_REDACT];
  if (observability.redact !== undefined) {
    if (
      !Array.isArray(observability.redact) ||
      !observability.redact.every((entry) => typeof entry === 'string')
    ) {
      throw new ConfigLoadError(
        'observability.redact',
        'must be an array of strings when set',
      );
    }
    redact = observability.redact;
  }

  return { logLevel, redact };
}

/**
 * Reads, parses and validates the Open Fusion config file, resolving every
 * `*Env` secret reference against `process.env`. Throws `ConfigLoadError`
 * synchronously on any problem so the caller (ConfigService's constructor)
 * fails NestJS application boot entirely rather than starting partially
 * (spec 003 acceptance criteria).
 */
export function loadAppConfig(): AppConfig {
  const filePath = resolveConfigPath();
  const parsed = readConfigFile(filePath);

  if (!isPlainObject(parsed)) {
    throw new ConfigLoadError('config', 'config root must be a JSON object');
  }

  validateVersion(parsed);
  const serverPort = validateServerPort(parsed);
  const apiKeys = validateApiKeys(parsed);
  const providers = validateProviders(parsed);
  const models = validateModels(parsed, providers);
  const routes = validateRoutes(parsed, models);
  const observability = validateObservability(parsed);

  return { serverPort, apiKeys, providers, models, routes, observability };
}
