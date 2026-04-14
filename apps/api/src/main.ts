import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as express from 'express';
import * as path from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS — allow mobile and web apps
  app.enableCors({
    origin: ['http://localhost:8081', 'http://localhost:3000', 'http://localhost:19006'],
    credentials: true,
  });

  // Global prefix
  app.setGlobalPrefix('api');

  // Serve uploaded video files statically (dev only — production uses CloudFront)
  app.use('/api/videos/file', express.static(path.join(process.cwd(), 'uploads', 'videos')));
  app.use('/api/training/drills/video', express.static(path.join(process.cwd(), 'uploads', 'drills')));

  // Swagger API docs
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
}

bootstrap();
