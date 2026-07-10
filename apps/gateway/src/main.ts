import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { CONFIG_SERVICE, ConfigService } from './config/config.interfaces';
import { LoggingInterceptor } from './common/logging/logging.interceptor';
import {
  appendLog,
  configureLogging,
  flushLogs,
  resolveLogFilePath,
} from './common/logging/log-file';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );
  app.useGlobalInterceptors(new LoggingInterceptor());

  const configService = app.get<ConfigService>(CONFIG_SERVICE);
  const config = configService.get();

  // Install the rotating file sink and register every resolved secret for
  // value-based redaction, so a provider apiKey or client token is stripped
  // wherever it might surface in a log line (spec 006).
  configureLogging({
    secrets: [
      ...config.providers.map((provider) => provider.apiKey),
      ...config.apiKeys.map((key) => key.token),
    ],
    maxSizeBytes: config.observability.logFile.maxSizeBytes,
    maxFiles: config.observability.logFile.maxFiles,
  });

  // Flush pending log entries on shutdown so nothing already accepted is lost.
  app.enableShutdownHooks();
  const flushOnExit = (): void => {
    void flushLogs();
  };
  process.once('SIGTERM', flushOnExit);
  process.once('SIGINT', flushOnExit);
  process.once('beforeExit', flushOnExit);

  const port = config.serverPort;
  await app.listen(port);

  const logFile = resolveLogFilePath();
  appendLog('info', 'gateway.boot', { port });
  Logger.log(`Request log -> ${logFile}`, 'Bootstrap');
}
void bootstrap();
