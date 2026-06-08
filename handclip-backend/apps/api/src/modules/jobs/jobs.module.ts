import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    SupabaseModule,
    AuthModule,
    BullModule.registerQueue(
      { name: 'transcription' },
      { name: 'clip-analysis' },
      { name: 'render' },
      { name: 'edit-prompt' },
    ),
  ],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
