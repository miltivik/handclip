import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TranscriptionProcessor } from './transcription.processor';
import { ClipAnalysisProcessor } from './clip-analysis.processor';
import { RenderProcessor } from './render.processor';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'transcription' },
      { name: 'clip-analysis' },
      { name: 'render' },
    ),
  ],
  providers: [TranscriptionProcessor, ClipAnalysisProcessor, RenderProcessor],
})
export class ProcessorsModule {}
