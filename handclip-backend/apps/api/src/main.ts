// Validate required env vars
const REQUIRED_VARS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'REDIS_HOST'];
const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { AppModule } from './app.module';
import { CatchEverythingFilter } from './filters/catch-everything.filter';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Global exception filter — catches 500s, hides stack traces in prod
  const httpAdapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(new CatchEverythingFilter(httpAdapterHost));

  // CORS
  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Internal-API-Key'],
  });

  // Request ID middleware — propagates x-request-id for structured logging
  app.use((req: any, res: any, next: any) => {
    req.id = req.headers['x-request-id'] || `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    res.setHeader('x-request-id', req.id);
    next();
  });

  // Security headers
  app.use(helmet());

  app.setGlobalPrefix('api');

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
  for (const signal of signals) {
    process.on(signal, async () => {
      console.log(`\nReceived ${signal}, shutting down gracefully...`);
      await app.close();
      process.exit(0);
    });
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`HandClip API running on http://localhost:${port}/api`);
}

bootstrap();
