import { Inject, Injectable } from '@nestjs/common';
import { CONFIG_SERVICE } from '../config/config.interfaces';
import type {
  ConfigService,
  ModelConfig,
  ProviderConfig,
} from '../config/config.interfaces';
import { GatewayApiException } from '../common/errors/gateway-api.exception';
import {
  ModelInvocationRequest,
  ModelInvocationResult,
  ModelInvoker,
  ModelStreamChunk,
} from './model-invoker.interfaces';
import {
  PROVIDER_ADAPTERS,
  ProviderAdapter,
} from './provider-adapter.interfaces';

interface ResolvedTarget {
  model: ModelConfig;
  provider: ProviderConfig;
  adapter: ProviderAdapter;
}

/**
 * The real MODEL_INVOKER (spec 004): resolves an internal model key to its
 * model + provider config, dispatches to the provider adapter registered for
 * that provider's `type`, and otherwise stays provider-agnostic. Swapping a
 * model's provider is a config change, not a code change (spec 004 acceptance).
 * Replaces the spec-002 FakeModelInvoker behind the MODEL_INVOKER seam with no
 * change to the orchestration engine that consumes it.
 */
@Injectable()
export class AdapterModelInvoker implements ModelInvoker {
  private readonly adaptersByType: Map<string, ProviderAdapter>;

  constructor(
    @Inject(CONFIG_SERVICE) private readonly configService: ConfigService,
    @Inject(PROVIDER_ADAPTERS) adapters: ProviderAdapter[],
  ) {
    this.adaptersByType = new Map(
      adapters.map((adapter) => [adapter.type, adapter]),
    );
  }

  async invoke(
    request: ModelInvocationRequest,
  ): Promise<ModelInvocationResult> {
    const target = this.resolve(request.modelKey);
    return target.adapter.invoke(target.model, target.provider, request);
  }

  stream(request: ModelInvocationRequest): AsyncIterable<ModelStreamChunk> {
    const target = this.resolve(request.modelKey);
    return target.adapter.stream(target.model, target.provider, request);
  }

  /**
   * Resolves the model→provider→adapter chain. All three lookups are
   * guaranteed by config validation (spec 003), so a miss here is an internal
   * inconsistency, surfaced as a normalized 500 rather than a raw crash. This
   * runs synchronously so a failure happens before any stream byte is written.
   */
  private resolve(modelKey: string): ResolvedTarget {
    const model = this.configService.findModelByKey(modelKey);
    if (!model) {
      throw GatewayApiException.internal(
        `No model is configured for key '${modelKey}'.`,
      );
    }
    const provider = this.configService.findProviderByName(model.provider);
    if (!provider) {
      throw GatewayApiException.internal(
        `Model '${modelKey}' references unconfigured provider '${model.provider}'.`,
      );
    }
    const adapter = this.adaptersByType.get(provider.type);
    if (!adapter) {
      throw GatewayApiException.internal(
        `No provider adapter is registered for type '${provider.type}'.`,
      );
    }
    return { model, provider, adapter };
  }
}
