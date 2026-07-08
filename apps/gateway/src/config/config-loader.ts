import * as fs from 'fs';
import * as path from 'path';
import { ApiKeyConfig, AppConfig, RouteConfig } from './config.interfaces';

const DEFAULT_CONFIG_RELATIVE_PATH = './config/open-fusion.config.json';

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

function validateRoutes(raw: Record<string, unknown>): RouteConfig[] {
  const routes = raw.routes;
  if (!isPlainObject(routes) || Object.keys(routes).length === 0) {
    throw new ConfigLoadError('routes', 'must be a non-empty object');
  }

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
    return { key, publicModel: value.publicModel };
  });
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
  const routes = validateRoutes(parsed);

  return { serverPort, apiKeys, routes };
}
