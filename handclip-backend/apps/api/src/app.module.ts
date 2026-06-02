import { NotificationsModule } from './modules/notifications/notifications.module';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { SupabaseModule } from './modules/supabase/supabase.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ClipsModule } from './modules/clips/clips.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { HealthModule } from './modules/health/health.module';
import { ExportsModule } from './modules/exports/exports.module';
import { AiConnectionsModule } from './modules/ai-connections/ai-connections.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([{
      ttl: 60000,      // 1 minute window
      limit: 100,       // 100 requests per minute
    }]),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    SupabaseModule,
    AuthModule,
    AiConnectionsModule,
    ProjectsModule,
    ClipsModule,
    UploadsModule,
    JobsModule,
    HealthModule,
    ExportsModule,
    NotificationsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}