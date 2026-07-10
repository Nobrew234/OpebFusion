import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { ErrorsModule } from './common/errors/errors.module';
import { ModelsModule } from './models/models.module';
import { ChatCompletionsModule } from './chat-completions/chat-completions.module';

@Module({
  imports: [ConfigModule, ErrorsModule, ModelsModule, ChatCompletionsModule],
})
export class AppModule {}
