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
 * A configured LLM provider (e.g. OpenRouter). `apiKeyEnv` holds the *name*
 * of the environment variable carrying the secret, never the secret itself —
 * the resolved value is only ever read at runtime by a provider adapter
 * (spec 004), never serialized (spec 003 "Resolucao de segredos").
 */
export interface ProviderConfig {
  name: string;
  type: string;
  apiKeyEnv: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  providerOptions?: Record<string, unknown>;
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
}

export interface AppConfig {
  serverPort: number;
  apiKeys: ApiKeyConfig[];
  providers: ProviderConfig[];
  models: ModelConfig[];
  routes: RouteConfig[];
}

export const CONFIG_SERVICE = Symbol('CONFIG_SERVICE');

export interface ConfigService {
  get(): AppConfig;
  findApiKeyByToken(token: string): ApiKeyConfig | undefined;
  findRouteByPublicModel(publicModel: string): RouteConfig | undefined;
  findModelByKey(key: string): ModelConfig | undefined;
  getPublicModels(): PublicModel[];
}
