import { Module } from '@nestjs/common';

// Feature modules are wired in here as each spec-001 slice lands
// (ConfigModule, AuthModule, ModelsModule, ErrorsModule, ChatCompletionsModule, OrchestrationModule).
@Module({
  imports: [],
})
export class AppModule {}
