const REQUIRED_VARS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'REDIS_HOST', 'INTERNAL_API_KEY', 'APP_URL'];
const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill in the values.');
  process.exit(1);
}
// CORS: require an explicit origin at boot instead of defaulting to '*'.
// ponytail: a wildcard origin is a footgun for a credentialed API; fail fast
// at startup if the operator forgot to set it rather than silently allowing
// any origin.
const corsOrigin = process.env.CORS_ORIGIN;
if (!corsOrigin) {
  throw new Error('CORS_ORIGIN env var is required');
}

import { randomUUID } from 'crypto';

import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { AppModule } from './app.module';
import { CatchEverythingFilter } from './filters/catch-everything.filter';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ponytail: trust proxy. Without this, req.ip is the TCP peer (the load
  // balancer), so the throttler + per-IP SSE cap collapse to per-proxy.
  // Default 1 hop (single ALB/nginx in front). Set TRUST_PROXY_HOPS
  // env to override when behind more proxies.
  // ponytail: getInstance() returns the underlying HTTP server (Express
  // here). The `set` method is Express-specific; the cast is local
  // to this one call and is the standard NestJS pattern for trust-proxy.
  const trustProxyHops = parseInt(process.env.TRUST_PROXY_HOPS || '1', 10);
  (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void })
    .set('trust proxy', trustProxyHops);

  // Global exception filter — catches 500s, hides stack traces in prod
  const httpAdapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(new CatchEverythingFilter(httpAdapterHost));

  // CORS
  app.enableCors({
    origin: corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Internal-API-Key'],
  });

  // Request ID middleware — propagates x-request-id for structured logging
  app.use((req: any, res: any, next: any) => {
    req.id = req.headers['x-request-id'] || randomUUID();
    res.setHeader('x-request-id', req.id);
    next();
  });

  // Security headers — explicit (helmet defaults are OK but loose).
  // hsts: 1 year + includeSubDomains + preload.
  // noSniff: prevent MIME sniffing.
  // referrerPolicy: don't leak referrers to third parties.
  // frameguard: deny embedding (API has no UI to embed).
  app.use(
    helmet({
      hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
      noSniff: true,
      referrerPolicy: { policy: 'no-referrer' },
      frameguard: { action: 'deny' },
    }),
  );

  app.setGlobalPrefix('api');

  // Graceful shutdown with timeout. In-flight requests get up to 10s to
  // finish; if they don't, force exit. Default Node behaviour is to drop
  // in-flight requests on SIGTERM, which causes 502s to the LB.
  const SHUTDOWN_TIMEOUT_MS = 10_000;
  const shutdown = async (signal: NodeJS.Signals) => {
    console.log(`\nReceived ${signal}, shutting down gracefully (max ${SHUTDOWN_TIMEOUT_MS / 1000}s)...`);
    const forceExit = setTimeout(() => {
      console.error(`Graceful shutdown timed out after ${SHUTDOWN_TIMEOUT_MS / 1000}s, forcing exit`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    try {
      await app.close();
      console.log('API shut down gracefully');
    } catch (err) {
      console.error('Error during shutdown:', err);
    } finally {
      clearTimeout(forceExit);
      process.exit(0);
    }
  };
  for (const signal of ['SIGTERM', 'SIGINT'] as NodeJS.Signals[]) {
    process.on(signal, () => shutdown(signal));
  }

  // ponytail: uncaughtException / unhandledRejection. Default Node
  // behaviour is to print the stack and exit 1 immediately, dropping
  // in-flight requests on the floor. With these handlers, we log
  // + try to shutdown gracefully.
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
    shutdown('SIGTERM');
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`HandClip API running on http://localhost:${port}/api`);
}
bootstrap();