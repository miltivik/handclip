import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { SubtitleSegment, SubtitleSegmentSchema } from '@handclip/shared';
import { SupabaseService } from '../modules/supabase/supabase.service';
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

  constructor(private readonly supabaseService: SupabaseService) {
    super();
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async process(job: Job<TranscriptionJobData>): Promise<{ segments: SubtitleSegment[] }> {
    const { projectId, videoUrl } = job.data;
    const supabase = this.supabaseService.getServiceRoleClient();

    // Create job record in DB
    const { data: jobRecord, error: jobCreateError } = await supabase
      .from('jobs')
      .insert({
        project_id: projectId,
        type: 'transcription',
        status: 'active',
        progress: 5,
        bullmq_id: job.id,
      })
      .select('id')
      .single();

    if (jobCreateError) {
      console.error(`[Transcription] Failed to create job record: ${jobCreateError.message}`);
    }
    const dbJobId = jobRecord?.id;

    await job.updateProgress(5);
    console.log(`[Transcription] Starting for project ${projectId}`);

    // Update projects status
    await supabase
      .from('projects')
      .update({ status: 'processing' })
      .eq('id', projectId);

    const tempDir = os.tmpdir();
    const videoPath = path.join(tempDir, `${projectId}-input.mp4`);
    const audioPath = path.join(tempDir, `${projectId}-audio.mp3`);

    try {
      // Step 1: Download video to temp file
      if (videoUrl.startsWith('http')) {
        const response = await fetch(videoUrl);
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(videoPath, buffer);
      } else {
        fs.copyFileSync(videoUrl, videoPath);
      }

      // Step 2: Extract audio with FFmpeg
      if (dbJobId) {
        await supabase.from('jobs').update({ progress: 20 }).eq('id', dbJobId);
      }
      await job.updateProgress(20);
      console.log(`[Transcription] Extracting audio for project ${projectId}`);

      await execAsync(
        `ffmpeg -i "${videoPath}" -vn -acodec libmp3lame -ar 16000 -ab 64k -y "${audioPath}" 2>&1`
      );

      // Step 3: Call Whisper API with word-level timestamps
      if (dbJobId) {
        await supabase.from('jobs').update({ progress: 40 }).eq('id', dbJobId);
      }
      await job.updateProgress(40);
      console.log(`[Transcription] Calling Whisper API for project ${projectId}`);

      const transcription = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['word'],
      });

      if (dbJobId) {
        await supabase.from('jobs').update({ progress: 70 }).eq('id', dbJobId);
      }
      await job.updateProgress(70);

      // Step 4: Convert Whisper output to SubtitleSegment[]
      const segments: SubtitleSegment[] = (transcription.segments || []).map((seg: any, segIdx: number) => {
        const words: SubtitleSegment['words'] = (seg.words || []).map((w: WhisperWord) => ({
          word: w.word,
          start: w.start,
          end: w.end,
          probability: 0.95,
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

      // Persist subtitles to DB
      const { error: subtitleError } = await supabase
        .from('subtitles')
        .insert({
          project_id: projectId,
          clip_id: null, // project-level subtitles (covers full video)
          segments,
          language: transcription.language || 'unknown',
        });

      if (subtitleError) {
        console.error(`[Transcription] Failed to persist subtitles: ${subtitleError.message}`);
      } else {
        console.log(`[Transcription] Persisted ${segments.length} segments to subtitles table`);
      }

      // Mark job as completed
      if (dbJobId) {
        await supabase
          .from('jobs')
          .update({
            status: 'completed',
            progress: 100,
            result: { segments_count: segments.length },
            updated_at: new Date().toISOString(),
          })
          .eq('id', dbJobId);
      }
      await job.updateProgress(100);
      console.log(`[Transcription] Completed for project ${projectId}: ${segments.length} segments`);

      // Step 5: Enqueue clip-analysis job
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
      console.log(`[Transcription] Enqueued clip-analysis for project ${projectId}`);

      return { segments };
    } catch (err: any) {
      console.error(`[Transcription] Failed for project ${projectId}: ${err.message}`);

      // Mark job as failed
      if (dbJobId) {
        await supabase
          .from('jobs')
          .update({
            status: 'failed',
            progress: 0,
            result: { error: err.message },
            updated_at: new Date().toISOString(),
          })
          .eq('id', dbJobId);
      }

      // Mark project as failed
      await supabase
        .from('projects')
        .update({ status: 'failed' })
        .eq('id', projectId);

      throw err;
    } finally {
      // Cleanup temp files
      try { fs.unlinkSync(videoPath); } catch {}
      try { fs.unlinkSync(audioPath); } catch {}
    }
  }
}
