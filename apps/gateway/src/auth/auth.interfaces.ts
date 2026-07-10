import { Request } from 'express';
import { ApiKeyConfig } from '../config/config.interfaces';

export interface AuthenticatedRequest extends Request {
  apiKey: ApiKeyConfig;
}
