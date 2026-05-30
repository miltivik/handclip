import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HealthController } from './health.controller';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [
    SupabaseModule,
    BullModule.registerQueue({ name: 'transcription' }),
  ],
  controllers: [HealthController],
})
export class HealthModule {}
