import { Injectable } from '@nestjs/common';
import {
  ApiKeyConfig,
  AppConfig,
  ConfigService as ConfigServiceContract,
  PublicModel,
  RouteConfig,
} from './config.interfaces';
import { loadAppConfig } from './config-loader';

/**
 * Loads and validates the Open Fusion config file on construction (see
 * config-loader.ts) and exposes the read-only lookups other modules need.
 * Any config problem throws synchronously from here, which — because this
 * is a NestJS provider — aborts application boot instead of starting the
 * server partially (spec 003).
 */
@Injectable()
export class ConfigService implements ConfigServiceContract {
  private readonly config: AppConfig;

  constructor() {
    this.config = loadAppConfig();
  }

  get(): AppConfig {
    return this.config;
  }

  findApiKeyByToken(token: string): ApiKeyConfig | undefined {
    return this.config.apiKeys.find((apiKey) => apiKey.token === token);
  }

  findRouteByPublicModel(publicModel: string): RouteConfig | undefined {
    return this.config.routes.find(
      (route) => route.publicModel === publicModel,
    );
  }

  getPublicModels(): PublicModel[] {
    return this.config.routes.map((route) => ({
      id: route.publicModel,
      ownedBy: 'open-fusion',
    }));
  }
}
