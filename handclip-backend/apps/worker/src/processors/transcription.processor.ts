import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { SubtitleSegment, SubtitleSegmentSchema } from '@handclip/shared';
import { SupabaseService } from '../modules/supabase/supabase.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { downloadSourceVideo } from './source-video';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

interface TranscriptionJobData {
  projectId: string;
  userId: string;
  // Storage path (preferred) — service-role download, no expiry.
  sourceVideoPath?: string;
  // Legacy: 1h signed URL. Kept for backward-compat with in-flight jobs
  // queued before the storage-path refactor.
  videoUrl?: string;
  trackingJobId?: string;
}

@Processor('transcription')
export class TranscriptionProcessor extends WorkerHost {
  private openai: OpenAI;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly notificationsService: NotificationsService,
    @InjectQueue('clip-analysis') private readonly clipQueue: Queue,
  ) {
    super();
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async process(job: Job<TranscriptionJobData>): Promise<{ segments: SubtitleSegment[] }> {
    const { projectId, userId, sourceVideoPath, videoUrl, trackingJobId } = job.data;
    const supabase = this.supabaseService.getServiceRoleClient();
    const dbProgress = (progress: number) =>
      trackingJobId ? Math.round(progress * 0.6) : progress;

    let dbJobId: string | undefined;
    if (trackingJobId) {
      const { data: jobRecord, error } = await supabase
        .from('jobs')
        .update({ status: 'active', progress: dbProgress(5) })
        .eq('id', trackingJobId)
        .select('id')
        .single();
      if (error) {
        console.error(`[Transcription] Failed to update job: ${error.message}`);
      }
      dbJobId = jobRecord?.id;
    } else {
      const { data: jobRecord, error } = await supabase
        .from('jobs')
        .insert({
          project_id: projectId,
          user_id: userId,
          type: 'transcription',
          status: 'active',
          progress: 5,
          bullmq_id: job.id,
        })
        .select('id')
        .single();
      if (error) {
        console.error(`[Transcription] Failed to create job record: ${error.message}`);
      }
      dbJobId = jobRecord?.id;
    }

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
      // Step 1: Download source video (storage path preferred; legacy URL fallback).
      await downloadSourceVideo(this.supabaseService, sourceVideoPath, videoUrl, videoPath);

      // Step 2: Extract audio with FFmpeg
      if (dbJobId) {
        await supabase.from('jobs').update({ progress: dbProgress(20) }).eq('id', dbJobId);
      }
      await job.updateProgress(20);
      console.log(`[Transcription] Extracting audio for project ${projectId}`);

      await execFileAsync(
        'ffmpeg',
        ['-i', videoPath, '-vn', '-acodec', 'libmp3lame', '-ar', '16000', '-ab', '64k', '-y', audioPath],
        { timeout: 600000 },
      );

      // Step 3: Call Whisper API with word-level timestamps
      if (dbJobId) {
        await supabase.from('jobs').update({ progress: dbProgress(40) }).eq('id', dbJobId);
      }
      await job.updateProgress(40);
      console.log(`[Transcription] Calling Whisper API for project ${projectId}`);

      // Step 3: Call Whisper API with word-level timestamps (with fallback)
      let transcription: any;
      try {
        transcription = await this.openai.audio.transcriptions.create({
          file: fs.createReadStream(audioPath),
          model: 'whisper-1',
          response_format: 'verbose_json',
          timestamp_granularities: ['word'],
        });
      } catch (apiError: any) {
        console.warn(`[Transcription] OpenAI Whisper failed: ${apiError.message}. Falling back to local mode.`);
        // Local fallback: use FFmpeg silence detection + basic segmentation
        // This is a degraded mode — no word-level timestamps, just segment detection
        transcription = await this.localTranscriptionFallback(audioPath, job);
      }

      if (dbJobId) {
        await supabase.from('jobs').update({ progress: dbProgress(70) }).eq('id', dbJobId);
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
            status: trackingJobId ? 'active' : 'completed',
            progress: dbProgress(100),
            result: trackingJobId
              ? { pipeline: 'analysis', segments_count: segments.length }
              : { segments_count: segments.length },
            updated_at: new Date().toISOString(),
          })
          .eq('id', dbJobId);
      }
      await job.updateProgress(100);
      console.log(`[Transcription] Completed for project ${projectId}: ${segments.length} segments`);

      // Step 5: Enqueue clip-analysis job
      await this.clipQueue.add('analyze-clips', {
        projectId,
        userId: job.data.userId,
        videoUrl,
        transcriptionSegments: segments,
        trackingJobId,
      });

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

      // Notify user. The analysis path (transcription has trackingJobId)
      // also needs a push because if transcription fails, clip-analysis
      // never runs and the user would otherwise never hear about the
      // failure. Success for the analysis path is still announced by
      // clip-analysis.processor.
      await this.notificationsService.sendPushNotification(
        userId,
        'El análisis falló',
        trackingJobId
          ? 'No se pudo transcribir el video. Inténtalo de nuevo.'
          : 'No se pudo transcribir el video. Inténtalo de nuevo.',
        { type: 'job_failed', projectId, jobId: dbJobId ?? '' },
      );

      throw err;
    } finally {
      // Cleanup temp files
      try { fs.unlinkSync(videoPath); } catch {}
      try { fs.unlinkSync(audioPath); } catch {}
    }
  }
  private async localTranscriptionFallback(
    audioPath: string,
    job: Job<TranscriptionJobData>,
  ): Promise<{ segments: any[]; language: string }> {
    // Use FFmpeg silencedetect to find speech segments
    // This provides rough timestamps without actual transcription
    const { stderr } = await execFileAsync(
      'ffmpeg',
      ['-i', audioPath, '-af', 'silencedetect=n=-30dB:d=0.5', '-f', 'null', '-'],
      { timeout: 60000 },
    );
    // Parse silence_start/silence_end from FFmpeg output
    const silenceStarts: number[] = [];
    const silenceEnds: number[] = [];
    const lines = stderr.split('\n');
    for (const line of lines) {
      const startMatch = line.match(/silence_start: ([\d.]+)/);
      const endMatch = line.match(/silence_end: ([\d.]+)/);
      if (startMatch) silenceStarts.push(parseFloat(startMatch[1]));
      if (endMatch) silenceEnds.push(parseFloat(endMatch[1]));
    }
    // Build segments from non-silence regions
    const segments: any[] = [];
    let segIdx = 0;
    let lastEnd = 0;
    for (let i = 0; i < silenceStarts.length; i++) {
      if (silenceStarts[i] > lastEnd) {
        // Non-silence region: [lastEnd, silenceStarts[i]]
        segments.push({
          id: `local-${job.data.projectId}-${segIdx}`,
          start: lastEnd,
          end: silenceStarts[i],
          text: `[Segmento ${segIdx + 1}]`,
          words: [],
        });
        segIdx++;
      }
      lastEnd = silenceEnds[i] || silenceStarts[i];
    }
    console.log(`[Transcription] Local fallback produced ${segments.length} segments`);
    return { segments, language: 'unknown' };
  }
}
