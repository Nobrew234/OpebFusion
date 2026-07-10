import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module';
import { ORCHESTRATION_SERVICE } from './orchestration.interfaces';
import { OrchestrationService } from './orchestration.service';
import { OrchestratorPromptBuilder } from './orchestrator-prompt.builder';

/**
 * Binds the ORCHESTRATION_SERVICE token to spec 002's real LLM-orchestrated
 * routing engine, which depends on the MODEL_INVOKER seam exported by
 * ProvidersModule (a deterministic fake until spec 004's real adapters land).
 * Nothing in the HTTP layer changed when the spec-001 FakeOrchestrationService
 * was swapped out here — that is the point of the seam.
 */
@Module({
  imports: [ProvidersModule],
  providers: [
    OrchestratorPromptBuilder,
    { provide: ORCHESTRATION_SERVICE, useClass: OrchestrationService },
  ],
  exports: [ORCHESTRATION_SERVICE],
})
export class OrchestrationModule {}
