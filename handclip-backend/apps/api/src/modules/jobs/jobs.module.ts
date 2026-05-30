import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [
    SupabaseModule,
    BullModule.registerQueue(
      { name: 'transcription' },
      { name: 'clip-analysis' },
      { name: 'render' },
    ),
  ],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}