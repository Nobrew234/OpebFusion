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

export interface RouteConfig {
  key: string;
  publicModel: string;
}

export interface AppConfig {
  serverPort: number;
  apiKeys: ApiKeyConfig[];
  routes: RouteConfig[];
}

export const CONFIG_SERVICE = Symbol('CONFIG_SERVICE');

export interface ConfigService {
  get(): AppConfig;
  findApiKeyByToken(token: string): ApiKeyConfig | undefined;
  findRouteByPublicModel(publicModel: string): RouteConfig | undefined;
  getPublicModels(): PublicModel[];
}
