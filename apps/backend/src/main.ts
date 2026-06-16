import './instrument';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import type { Request, Response } from 'express';
import { AppModule } from './app.module';
import { SentryExceptionFilter } from './common/filters/sentry-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'error', 'warn'],
    rawBody: true,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3001);
  const frontendUrl = configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
  const allowedOrigins = Array.from(new Set([frontendUrl, 'http://localhost:3000', 'http://localhost:3001']));

  // Default body size limits are too small for bulk operations (e.g. CSV contact imports
  // with hundreds of rows). Raise them while preserving the rawBody capture webhooks rely on.
  app.useBodyParser('json', { limit: '20mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '20mb' });

  app.use(helmet());
  app.use(cookieParser());

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID', 'X-Api-Key'],
  });

  app.enableVersioning({ type: VersioningType.URI });

  app.useGlobalFilters(new SentryExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.setGlobalPrefix('api/v1');

  const swaggerConfig = new DocumentBuilder()
    .setTitle('WhatsApp Platform API')
    .setDescription('Multi-tenant WhatsApp Business Messaging Platform')
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'X-Tenant-ID', in: 'header' }, 'tenant-id')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  app.getHttpAdapter().get('/api/v1/health', (_req: Request, res: Response) => res.json({ status: 'ok' }));

  await app.listen(port);
  console.log(`Backend API running on port ${port}`);
}

bootstrap();
