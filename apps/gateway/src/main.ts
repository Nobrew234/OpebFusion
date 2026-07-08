import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { CONFIG_SERVICE, ConfigService } from './config/config.interfaces';

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
  const configService = app.get<ConfigService>(CONFIG_SERVICE);
  await app.listen(configService.get().serverPort);
}
bootstrap();
