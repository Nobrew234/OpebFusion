export interface PublicModel {
  id: string;
  ownedBy: string;
  createdAt?: number;
}

export interface ApiKeyConfig {
  id: string;
  token: string;
  allowedRoutes: string[];
}

/**
 * A configured LLM provider (e.g. OpenRouter). In the JSON file the secret is
 * a `apiKeyEnv` *reference* to an environment variable — never a literal. The
 * loader resolves it at boot into `apiKey`, mirroring how `tokenEnv` becomes
 * `token`; the resolved value is only read at runtime by a provider adapter
 * (spec 004) and MUST never be serialized into logs, errors, or responses
 * (spec 003 "Resolucao de segredos"). `apiKey` is optional only in the
 * documented permissive local-dev mode (`OPEN_FUSION_ALLOW_MISSING_SECRETS`).
 */
export interface ProviderConfig {
  name: string;
  type: string;
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  providerOptions?: Record<string, unknown>;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Size-based rotation/retention policy for the structured log file (spec 006,
 * "Rotacao e retencao"). Both fields have safe defaults so the section can be
 * omitted; when set they bound total disk use so the log cannot grow without
 * limit. `maxFiles` is how many rotated files (`.1`..`.N`) are kept.
 */
export interface LogFileConfig {
  maxSizeBytes: number;
  maxFiles: number;
}

export interface ObservabilityConfig {
  logLevel: LogLevel;
  /** Key names whose values must be redacted before any structured logging. */
  redact: string[];
  logFile: LogFileConfig;
}

export type ModelRole = 'orchestrator' | 'delegate';

/**
 * An internal model entry. `key` is the internal id (e.g. `worker.fast`),
 * `provider` references a `ProviderConfig.name`, and `model` is the real
 * provider model id (e.g. `openai/gpt-4.1-mini`). The public client never
 * sees `key`/`model` — only the route's `publicModel` (spec 004).
 */
export interface ModelConfig {
  key: string;
  provider: string;
  model: string;
  role: ModelRole;
  capabilities: string[];
  defaults?: Record<string, unknown>;
}

/**
 * A public route plus its orchestration/routing policy (spec 002). The client
 * only ever references `publicModel`; everything else is server-side policy
 * the orchestration engine enforces deterministically.
 */
export interface RouteConfig {
  key: string;
  publicModel: string;
  orchestrator: string;
  allowedDelegateModels: string[];
  maxDelegations: number;
  maxDepth: number;
  timeoutMs?: number;
  delegateTimeoutMs?: number;
  maxMessages?: number;
  maxMessageContentLength?: number;
  maxPayloadBytes?: number;
  streamFinalOnly: boolean;
  /**
   * Whether client-supplied external tools are forwarded to the orchestrator
   * for this route (spec 005 "Tool calling"). Defaults to `false`: unless a
   * route opts in explicitly, external tools are dropped and never reach a
   * provider. The internal `delegate_llm` tool is unaffected by this flag.
   */
  allowExternalTools: boolean;
}

export interface AppConfig {
  serverPort: number;
  apiKeys: ApiKeyConfig[];
  providers: ProviderConfig[];
  models: ModelConfig[];
  routes: RouteConfig[];
  observability: ObservabilityConfig;
}

export const CONFIG_SERVICE = Symbol('CONFIG_SERVICE');

export interface ConfigService {
  get(): AppConfig;
  findApiKeyByToken(token: string): ApiKeyConfig | undefined;
  findRouteByPublicModel(publicModel: string): RouteConfig | undefined;
  findModelByKey(key: string): ModelConfig | undefined;
  findProviderByName(name: string): ProviderConfig | undefined;
  getObservability(): ObservabilityConfig;
  getPublicModels(): PublicModel[];
}
