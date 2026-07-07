import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Validate every DTO with class-validator; strip unknown props and reject
  // payloads carrying non-whitelisted fields. UUID route params use ParseUUIDPipe
  // per-handler (see common/README and the RequirePermissions convention).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors();

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
