import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { CONFIG_SERVICE } from '../config/config.interfaces';
import type { ConfigService } from '../config/config.interfaces';
import { GatewayApiException } from '../common/errors/gateway-api.exception';
import { AuthenticatedRequest } from './auth.interfaces';

const BEARER_PREFIX = 'Bearer ';

// Only decides *who* is calling (401); route/model authorization (403/404) happens downstream.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(CONFIG_SERVICE) private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers['authorization'];

    if (!header || Array.isArray(header) || !header.startsWith(BEARER_PREFIX)) {
      throw GatewayApiException.unauthorized();
    }

    const token = header.slice(BEARER_PREFIX.length).trim();
    if (!token) {
      throw GatewayApiException.unauthorized();
    }

    const apiKey = this.configService.findApiKeyByToken(token);
    if (!apiKey) {
      throw GatewayApiException.unauthorized();
    }

    request.apiKey = apiKey;
    return true;
  }
}
