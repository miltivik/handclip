// Validate required env vars
const REQUIRED_VARS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'REDIS_HOST', 'OPENAI_API_KEY', 'INTERNAL_API_KEY', 'REDIS_PASSWORD'];
const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const SHUTDOWN_TIMEOUT_MS = 30_000;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = parseInt(process.env.WORKER_PORT || '3001', 10);
  await app.listen(port);
  console.log(`HandClip Worker running on http://localhost:${port}`);
  console.log(`Health check: http://localhost:${port}/health`);

  // ponytail: SHUTDOWN_TIMEOUT_MS is 30s (not 10s like API) because
  // ffmpeg renders can run for 5+ minutes. Nest's app.close() waits
  // for in-flight jobs to finish — we'd rather wait than corrupt a
  // video by killing FFmpeg mid-encode. The force-exit kicks in at
  // 30s to bound the shutdown.
  const SHUTDOWN_TIMEOUT_MS = 30_000;
  const shutdown = async (signal: NodeJS.Signals) => {
    console.log(`${signal} received, shutting down gracefully (max ${SHUTDOWN_TIMEOUT_MS / 1000}s)...`);
    const forceExit = setTimeout(() => {
      console.error(`Graceful shutdown timed out after ${SHUTDOWN_TIMEOUT_MS / 1000}s, forcing exit`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    try {
      await app.close();
      console.log('Worker shut down gracefully');
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

  // ponytail: uncaughtException / unhandledRejection. The render
  // processor's ffmpeg child tracking + onApplicationShutdown fires
  // for clean exits; this is the safety net for crashes outside
  // the Nest lifecycle (e.g. a stray import-time throw).
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
    shutdown('SIGTERM');
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
  });
}
