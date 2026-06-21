import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { SupabaseModule } from './modules/supabase/supabase.module';
import { ProcessorsModule } from './processors/processors.module';
import { HealthModule } from './health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
        maxRetriesPerRequest: null,
      },
      // ponytail: default options applied to every job that doesn't
      // override them. 3 attempts with exponential backoff for transient
      // 5xx/429/timeout; retention caps prevent Redis bloat.
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    }),
    SupabaseModule,
    ProcessorsModule,
    HealthModule,
  ],
})
export class AppModule {}
