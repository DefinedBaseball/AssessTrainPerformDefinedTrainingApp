import 'reflect-metadata';

/* Sentry init MUST happen before any other imports (per @sentry/nestjs docs)
 * so the SDK can patch http/express modules at require time. The DSN is
 * env-driven — when SENTRY_DSN is unset (dev, local), `init` is a no-op
 * and emits no traffic. tracesSampleRate is conservative for cost control;
 * bump it via SENTRY_TRACES_SAMPLE_RATE if you need richer perf data. */
import * as Sentry from '@sentry/nestjs';
import { nestIntegration } from '@sentry/nestjs';
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    profilesSampleRate: 0,
    integrations: [nestIntegration()],
  });
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as express from 'express';
import * as path from 'path';
import helmet from 'helmet';
import { AppModule } from './app.module';

/**
 * Default origins used in dev when CORS_ORIGINS isn't set. Local web (3000),
 * Expo web (19006), Expo native dev tools (8081) — all loopback. Production
 * MUST set CORS_ORIGINS to its real allowlist (comma-separated).
 */
const DEV_DEFAULT_ORIGINS = [
  'http://localhost:8081',
  'http://localhost:3000',
  'http://localhost:19006',
];

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Disable the built-in body parser so we can raise the JSON/urlencoded
    // limit below. The default ~100 KB cap was too small for reports whose
    // `content` embeds a parsed At-Bat XLSX (the at-bats + every pitch can
    // run to hundreds of KB). An oversized body made Express throw a raw
    // PayloadTooLargeError that NestJS surfaced to the client as a generic
    // 500 "Internal server error" on save. Multipart video/CSV uploads go
    // through multer (FileInterceptor) and are bounded separately per-route,
    // so they're unaffected by these JSON limits.
    bodyParser: false,
  });
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ limit: '25mb', extended: true }));

  /* Sentry's @sentry/nestjs auto-instruments Express + the Node http
   * module via nestIntegration (registered in Sentry.init above), so
   * unhandled exceptions and slow requests are captured automatically.
   * No additional Nest-specific wiring is required for v10 of the SDK. */

  // ── Security headers ────────────────────────────────────────────────
  // helmet sets a sane default set: HSTS, no-sniff, X-Frame-Options, etc.
  // contentSecurityPolicy is left disabled because the API serves no HTML
  // and Swagger UI inlines styles/scripts that would trip a strict CSP.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

  // ── CORS — env-driven allowlist ─────────────────────────────────────
  // Production reads CORS_ORIGINS as a comma-separated list of exact
  // origins. If a request's Origin header isn't on the list, the browser
  // blocks the response. No wildcard — tokens go in Authorization headers
  // and we explicitly opt into credentials below.
  const envOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const corsOrigins = envOrigins.length > 0 ? envOrigins : DEV_DEFAULT_ORIGINS;
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ── Global validation ───────────────────────────────────────────────
  // class-validator was already a dependency but no global pipe was
  // registered. Existing DTOs are plain TypeScript classes with no
  // decorators yet (e.g. `class LoginDto { email!: string }`), so we can
  // ONLY enable `transform` here — turning on `whitelist` /
  // `forbidNonWhitelisted` would reject every legitimate request because
  // class-validator sees zero whitelisted properties. Once DTOs are
  // migrated to use @IsString / @IsEmail / etc. those flags can be
  // flipped on per-DTO via individual ValidationPipe instances.
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
    }),
  );

  // ── Global prefix ───────────────────────────────────────────────────
  app.setGlobalPrefix('api');

  // ── Static uploads (dev only) ───────────────────────────────────────
  // In production the storage abstraction (StorageService) writes to S3
  // and the URLs point at CloudFront. These routes only exist for local
  // file storage — they no-op when STORAGE_DRIVER=s3 because uploads
  // never land on disk in that mode.
  if ((process.env.STORAGE_DRIVER || 'local') === 'local') {
    app.use('/api/videos/file', express.static(path.join(process.cwd(), 'uploads', 'videos')));
    app.use('/api/training/drills/video', express.static(path.join(process.cwd(), 'uploads', 'drills')));
  }

  // ── Swagger API docs ────────────────────────────────────────────────
  const config = new DocumentBuilder()
    .setTitle('Player Development API')
    .setDescription('Baseball player development platform API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`API running on http://localhost:${port}`);
  console.log(`Swagger docs at http://localhost:${port}/api/docs`);
  console.log(`CORS origins: ${corsOrigins.join(', ')}`);
}

bootstrap();
