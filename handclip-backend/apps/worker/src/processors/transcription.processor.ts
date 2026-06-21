import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { SubtitleSegment, SubtitleSegmentSchema } from '@handclip/shared';
import { SupabaseService } from '../modules/supabase/supabase.service';
import { validatePublicUrl } from '@handclip/shared';
import { validateTempPath } from '../utils/validate-path';
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

  constructor(
    private readonly supabaseService: SupabaseService,
    @InjectQueue('clip-analysis') private clipAnalysisQueue: Queue,
  ) {
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
      let downloadUrl: string;
      if (videoUrl.startsWith('http')) {
        downloadUrl = await validatePublicUrl(videoUrl);
      } else {
        downloadUrl = videoUrl; // local file path
      }

      if (downloadUrl.startsWith('http')) {
        const response = await fetch(downloadUrl);
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.startsWith('video/') && !contentType.startsWith('audio/')) {
          throw new Error(`Unexpected content type: ${contentType}. Expected video/audio.`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(videoPath, buffer);
      }

      // Step 2: Normalize video format (transcode exotic codecs to H.264/AAC)
      if (dbJobId) {
        await supabase.from('jobs').update({ progress: 15 }).eq('id', dbJobId);
      }
      await job.updateProgress(15);
      console.log(`[Transcription] Checking video format for project ${projectId}`);

      const normalizedPath = await this.normalizeVideoFormat(videoPath, projectId);
      const sourcePath = normalizedPath || videoPath;

      // Step 3: Extract audio with FFmpeg
      if (dbJobId) {
        await supabase.from('jobs').update({ progress: 20 }).eq('id', dbJobId);
      }
      await job.updateProgress(20);
      console.log(`[Transcription] Extracting audio for project ${projectId}`);

      const safeVideoPath = validateTempPath(videoPath);
      const safeAudioPath = validateTempPath(audioPath);
      await execAsync(
        `ffmpeg -i "${safeVideoPath}" -vn -acodec libmp3lame -ar 16000 -ab 64k -y "${safeAudioPath}" 2>&1`
      );

      // Step 3: Call Whisper API with word-level timestamps
      if (dbJobId) {
        await supabase.from('jobs').update({ progress: 40 }).eq('id', dbJobId);
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
      // Step 5: Enqueue clip-analysis job via injected queue (reuses BullMQ connection)
      const analysisBullJob = await this.clipAnalysisQueue.add('analyze-clips', {
        projectId,
        videoUrl,
        transcriptionSegments: segments,
      }, {
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 20 },
      });

      // Link BullMQ job ID to the pre-created clip_analysis DB record
      const { data: existingAnalysis } = await supabase
        .from('jobs')
        .select('id')
        .eq('project_id', projectId)
        .eq('type', 'clip_analysis')
        .eq('status', 'queued')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (existingAnalysis) {
        await supabase
          .from('jobs')
          .update({ bullmq_id: analysisBullJob.id as string })
          .eq('id', existingAnalysis.id);
      }

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

  /**
   * Detects video/audio codecs with ffprobe and transcodes to H.264/AAC if needed.
   * Returns the path to the normalized file, or null if no normalization was needed.
   */
  private async normalizeVideoFormat(
    inputPath: string,
    projectId: string,
  ): Promise<string | null> {
    try {
      const { stdout } = await execAsync(
        `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${validateTempPath(inputPath)}"`,
        { timeout: 15000 },
      );
      const videoCodec = stdout.trim();

      let audioCodec = '';
      try {
        const { stdout: audioOut } = await execAsync(
          `ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${validateTempPath(inputPath)}"`,
          { timeout: 10000 },
        );
        audioCodec = audioOut.trim();
      } catch {
        // No audio stream — that's fine
        audioCodec = 'none';
      }

      const needsTranscode =
        !['h264', 'avc1'].includes(videoCodec) ||
        (audioCodec !== 'none' && !['aac', 'mp3'].includes(audioCodec));

      if (!needsTranscode) {
        console.log(`[Transcription] Video format OK: ${videoCodec}/${audioCodec}, skipping normalization`);
        return null;
      }

      console.log(`[Transcription] Normalizing video: ${videoCodec}/${audioCodec} → H.264/AAC`);
      const normalizedPath = path.join(os.tmpdir(), `${projectId}-normalized.mp4`);
      validateTempPath(normalizedPath);

      await execAsync(
        `ffmpeg -i "${validateTempPath(inputPath)}" -c:v libx264 -preset ultrafast -crf 23 -c:a aac -b:a 128k -y "${normalizedPath}" 2>&1`,
        { timeout: 300000 },
      );

      console.log(`[Transcription] Normalization complete: ${normalizedPath}`);
      return normalizedPath;
    } catch (err: any) {
      console.warn(`[Transcription] Normalization probe/transcode failed: ${err.message}. Using original file.`);
      return null;
    }
  }

  private async localTranscriptionFallback(
    audioPath: string,
    job: Job<TranscriptionJobData>,
  ): Promise<{ segments: any[]; language: string }> {
    // Use FFmpeg silencedetect to find speech segments
    // This provides rough timestamps without actual transcription
    const { stdout } = await execAsync(
      `ffmpeg -i "${audioPath}" -af "silencedetect=n=-30dB:d=0.5" -f null - 2>&1`,
      { timeout: 60000 },
    );
    // Parse silence_start/silence_end from FFmpeg output
    const silenceStarts: number[] = [];
    const silenceEnds: number[] = [];
    const lines = stdout.split('\n');
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
