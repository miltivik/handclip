import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { SupabaseModule } from './modules/supabase/supabase.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ClipsModule } from './modules/clips/clips.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { HealthModule } from './modules/health/health.module';
import { ExportsModule } from './modules/exports/exports.module';

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
      },
    }),
    SupabaseModule,
    AuthModule,
    ProjectsModule,
    ClipsModule,
    UploadsModule,
    JobsModule,
    HealthModule,
    ExportsModule,
  ],
})
export class AppModule {}
