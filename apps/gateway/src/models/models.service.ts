import { Inject, Injectable } from '@nestjs/common';
import { CONFIG_SERVICE } from '../config/config.interfaces';
import type { ConfigService } from '../config/config.interfaces';

export interface OpenAiModel {
  id: string;
  object: 'model';
  created?: number;
  owned_by: string;
}

export interface OpenAiModelList {
  object: 'list';
  data: OpenAiModel[];
}

/**
 * Builds the OpenAI-compatible `GET /v1/models` list envelope.
 * Only ever reads from `ConfigService.getPublicModels()` — never reaches into
 * `configService.get().routes` directly — so internal route keys can never
 * leak as public model ids (spec 001 "GET /v1/models").
 */
@Injectable()
export class ModelsService {
  constructor(
    @Inject(CONFIG_SERVICE) private readonly configService: ConfigService,
  ) {}

  listModels(): OpenAiModelList {
    return {
      object: 'list',
      data: this.configService
        .getPublicModels()
        .map((publicModel) => this.toOpenAiModel(publicModel)),
    };
  }

  private toOpenAiModel(publicModel: {
    id: string;
    ownedBy: string;
    createdAt?: number;
  }): OpenAiModel {
    const model: OpenAiModel = {
      id: publicModel.id,
      object: 'model',
      owned_by: publicModel.ownedBy,
    };
    if (publicModel.createdAt !== undefined) {
      model.created = publicModel.createdAt;
    }
    return model;
  }
}
