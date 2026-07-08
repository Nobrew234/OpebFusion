import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { OpenAiExceptionFilter } from './openai-exception.filter';

/**
 * Wires OpenAiExceptionFilter as a global, DI-based exception filter via
 * Nest's APP_FILTER token. Importing this module into AppModule is enough
 * to get global OpenAI-compatible error handling — no app.useGlobalFilters(...)
 * call needed in main.ts.
 */
@Module({
  providers: [{ provide: APP_FILTER, useClass: OpenAiExceptionFilter }],
})
export class ErrorsModule {}
