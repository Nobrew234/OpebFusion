import { Module } from '@nestjs/common';
import { OrchestrationModule } from '../orchestration/orchestration.module';
import { ChatCompletionsController } from './chat-completions.controller';
import { ChatCompletionsService } from './chat-completions.service';

// CONFIG_SERVICE is not provided here: at runtime it's bound globally by the
// integrator's ConfigModule; in isolated tests it must be supplied
// explicitly (see chat-completions.e2e-spec.ts).
@Module({
  imports: [OrchestrationModule],
  controllers: [ChatCompletionsController],
  providers: [ChatCompletionsService],
})
export class ChatCompletionsModule {}
