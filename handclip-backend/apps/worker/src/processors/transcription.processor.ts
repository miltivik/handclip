import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { SubtitleSegment, SubtitleSegmentSchema } from '@handclip/shared';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

interface TranscriptionJobData {
  projectId: string;
  videoUrl: string;
}

@Processor('transcription')
export class TranscriptionProcessor extends WorkerHost {
  private openai: OpenAI;

  constructor() {
    super();
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async process(job: Job<TranscriptionJobData>): Promise<{ segments: SubtitleSegment[] }> {
    const { projectId, videoUrl } = job.data;

    await job.updateProgress(5);
    console.log(`[Transcription] Starting for project ${projectId}`);

    // Step 1: Download video to temp file
    await job.updateProgress(10);
    const tempDir = os.tmpdir();
    const videoPath = path.join(tempDir, `${projectId}-input.mp4`);
    const audioPath = path.join(tempDir, `${projectId}-audio.mp3`);

    try {
      // Download (if remote URL) or copy (if local path)
      if (videoUrl.startsWith('http')) {
        const response = await fetch(videoUrl);
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(videoPath, buffer);
      } else {
        fs.copyFileSync(videoUrl, videoPath);
      }

      // Step 2: Extract audio with FFmpeg
      await job.updateProgress(20);
      console.log(`[Transcription] Extracting audio from video for project ${projectId}`);

      await execAsync(
        `ffmpeg -i "${videoPath}" -vn -acodec libmp3lame -ar 16000 -ab 64k -y "${audioPath}" 2>&1`
      );

      // Step 3: Call Whisper API with word-level timestamps
      await job.updateProgress(40);
      console.log(`[Transcription] Calling Whisper API for project ${projectId}`);

      const transcription = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['word'],
      });

      await job.updateProgress(70);

      // Step 4: Convert Whisper output to SubtitleSegment[]
      const segments: SubtitleSegment[] = (transcription.segments || []).map((seg: any, segIdx: number) => {
        const words: SubtitleSegment['words'] = (seg.words || []).map((w: WhisperWord) => ({
          word: w.word,
          start: w.start,
          end: w.end,
          probability: 0.95, // Whisper verbose_json doesn't return per-word probability without extra config
        }));

        return SubtitleSegmentSchema.parse({
          id: `seg-${projectId}-${segIdx}`,
          text: seg.text?.trim() || '',
          startTime: seg.start,
          endTime: seg.end,
          words,
          language: transcription.language || 'unknown',
        });
      });

      await job.updateProgress(100);
      console.log(`[Transcription] Completed for project ${projectId}: ${segments.length} segments`);

      // Step 5: Enqueue clip-analysis job with transcription segments
      const clipQueue = new Queue('clip-analysis', {
        connection: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379', 10),
        },
      });

      await clipQueue.add('analyze-clips', {
        projectId,
        videoUrl,
        transcriptionSegments: segments,
      });

      await clipQueue.close();
      console.log(`[Transcription] Enqueued clip-analysis job for project ${projectId}`);

      return { segments };
    } finally {
      // Cleanup temp files
      try { fs.unlinkSync(videoPath); } catch {}
      try { fs.unlinkSync(audioPath); } catch {}
    }
  }
}