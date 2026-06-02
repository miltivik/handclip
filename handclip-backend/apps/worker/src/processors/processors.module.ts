import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { TranscriptionProcessor } from './transcription.processor';
import { ClipAnalysisProcessor } from './clip-analysis.processor';
import { RenderProcessor } from './render.processor';
import { SupabaseModule } from '../modules/supabase/supabase.module';

@Module({
  imports: [
    ConfigModule,
    SupabaseModule,
    BullModule.registerQueue(
      { name: 'transcription' },
      { name: 'clip-analysis' },
      { name: 'render' },
    ),
  ],
  providers: [TranscriptionProcessor, ClipAnalysisProcessor, RenderProcessor],
})
export class ProcessorsModule {}
