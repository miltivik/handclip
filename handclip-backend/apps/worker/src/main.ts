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

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down gracefully (max ${SHUTDOWN_TIMEOUT_MS / 1000}s)...`);

    // Force exit if graceful shutdown takes too long
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

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap();
