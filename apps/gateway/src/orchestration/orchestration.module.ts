import { Module } from '@nestjs/common';
import { FakeOrchestrationService } from './fake-orchestration.service';
import { ORCHESTRATION_SERVICE } from './orchestration.interfaces';

// Binds the ORCHESTRATION_SERVICE token to the deterministic fake target.
// Swap the `useClass` (or provide a real factory) once spec 002's real
// orchestrator lands — nothing outside this module needs to change.
@Module({
  providers: [
    { provide: ORCHESTRATION_SERVICE, useClass: FakeOrchestrationService },
  ],
  exports: [ORCHESTRATION_SERVICE],
})
export class OrchestrationModule {}
