import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModelsService } from './models.service';
import type { OpenAiModelList } from './models.service';

/**
 * `GET /v1/models` (spec 001). The global `v1` prefix is applied at the app
 * level (main.ts, owned by the integrator), so this controller's own route
 * is just `models`.
 */
@Controller('models')
export class ModelsController {
  constructor(private readonly modelsService: ModelsService) {}

  @UseGuards(AuthGuard)
  @Get()
  listModels(): OpenAiModelList {
    return this.modelsService.listModels();
  }
}
