import { ModelConfig, ProviderConfig } from '../config/config.interfaces';
import {
  ModelInvocationRequest,
  ModelInvocationResult,
  ModelStreamChunk,
} from './model-invoker.interfaces';

/**
 * A provider adapter (ADR 0007, spec 004). Each adapter converts an internal
 * model + provider config into Vercel AI SDK primitives, supports non-streaming
 * and streaming calls plus tool calling, and normalizes provider errors and
 * usage metadata BEFORE anything leaves the adapter boundary. Controllers and
 * the orchestration engine never see a provider SDK — only this contract.
 */
export interface ProviderAdapter {
  /** The `providers.<name>.type` value this adapter handles (e.g. 'openrouter'). */
  readonly type: string;
  invoke(
    model: ModelConfig,
    provider: ProviderConfig,
    request: ModelInvocationRequest,
  ): Promise<ModelInvocationResult>;
  stream(
    model: ModelConfig,
    provider: ProviderConfig,
    request: ModelInvocationRequest,
  ): AsyncIterable<ModelStreamChunk>;
}

/** DI token for the registered list of provider adapters. */
export const PROVIDER_ADAPTERS = Symbol('PROVIDER_ADAPTERS');
