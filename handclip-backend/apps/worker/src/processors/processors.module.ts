import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { TranscriptionProcessor } from './transcription.processor';
import { ClipAnalysisProcessor } from './clip-analysis.processor';
import { RenderProcessor } from './render.processor';
import { CleanupProcessor } from './cleanup.processor';
import { EditPromptProcessor } from './edit-prompt.processor';
import { SupabaseModule } from '../modules/supabase/supabase.module';
import { NotificationsModule } from '../modules/notifications/notifications.module';

@Module({
  imports: [
    ConfigModule,
    SupabaseModule,
    NotificationsModule,
    BullModule.registerQueue(
      { name: 'transcription' },
      { name: 'clip-analysis' },
      { name: 'render' },
      { name: 'cleanup' },
      { name: 'edit-prompt' },
    ),
  ],
  providers: [
    TranscriptionProcessor,
    ClipAnalysisProcessor,
    RenderProcessor,
    CleanupProcessor,
    EditPromptProcessor,
  ],
})
export class ProcessorsModule {}
