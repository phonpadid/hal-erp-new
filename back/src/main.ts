import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Signature background-removal round-trips the (small, cropped) image as base64 JSON;
  // raise the default 100kb JSON limit so those requests aren't rejected.
  app.useBodyParser('json', { limit: '8mb' });

  // Validate every DTO with class-validator; strip unknown props and reject
  // payloads carrying non-whitelisted fields. UUID route params use ParseUUIDPipe
  // per-handler (see common/README and the RequirePermissions convention).
  // app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors();

  app.setGlobalPrefix('api-new');

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
