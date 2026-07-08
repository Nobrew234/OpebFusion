import { Module } from '@nestjs/common';
import { FakeModelInvoker } from './fake-model-invoker';
import { MODEL_INVOKER } from './model-invoker.interfaces';

/**
 * Binds the MODEL_INVOKER seam (ADR 0007). Until spec 004's real provider
 * adapters land, it resolves to the deterministic FakeModelInvoker. Swapping
 * to the adapter-backed invoker later is a change confined to this module —
 * the orchestration engine that depends on MODEL_INVOKER stays untouched.
 */
@Module({
  providers: [{ provide: MODEL_INVOKER, useClass: FakeModelInvoker }],
  exports: [MODEL_INVOKER],
})
export class ProvidersModule {}
