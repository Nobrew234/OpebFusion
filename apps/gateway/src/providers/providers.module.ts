import { Module } from '@nestjs/common';
import { AdapterModelInvoker } from './adapter-model-invoker';
import { MODEL_INVOKER } from './model-invoker.interfaces';
import { PROVIDER_ADAPTERS } from './provider-adapter.interfaces';
import { OpenRouterAdapter } from './openrouter/openrouter.adapter';
import { OPENROUTER_SDK, RealOpenRouterSdk } from './openrouter/openrouter-sdk';

/**
 * Wires the provider layer (spec 004). MODEL_INVOKER now resolves to the real
 * adapter-backed invoker; OpenRouter is the one registered adapter (ADR 0006),
 * backed by the real Vercel AI SDK port. Adding a provider means implementing
 * its adapter and adding it to PROVIDER_ADAPTERS — no controller or
 * orchestration change (spec 004 acceptance). In tests the OPENROUTER_SDK port
 * is overridden with a fake so no real network call happens.
 */
@Module({
  providers: [
    { provide: OPENROUTER_SDK, useClass: RealOpenRouterSdk },
    OpenRouterAdapter,
    {
      provide: PROVIDER_ADAPTERS,
      useFactory: (openRouter: OpenRouterAdapter) => [openRouter],
      inject: [OpenRouterAdapter],
    },
    { provide: MODEL_INVOKER, useClass: AdapterModelInvoker },
  ],
  exports: [MODEL_INVOKER],
})
export class ProvidersModule {}
