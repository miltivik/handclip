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
import { spawn } from 'child_process';

/** Run a command via spawn, capturing stdout+stderr. Rejects on non-zero exit. */
function runCommand(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { timeout: timeoutMs });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => stdoutChunks.push(d));
    child.stderr.on('data', (d: Buffer) => stderrChunks.push(d));
    child.on('error', (err) => reject(new Error(`${cmd} spawn failed: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) {
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString(),
          stderr: Buffer.concat(stderrChunks).toString(),
        });
      } else {
        const tail = Buffer.concat(stderrChunks).toString().slice(-500);
        reject(new Error(`${cmd} exited with code ${code}: ${tail}`));
      }
    });
  });
}

interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

interface TranscriptionJobData {
  projectId: string;
  videoUrl: string;
}

@Processor('transcription', { lockDuration: 600000, lockRenewTime: 30000 })
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

    let transcriptionDegraded = false;
    try {
      // Step 1: Download video
      // ponytail: reject local paths. validatePublicUrl enforces HTTPS +
      // blocks private/loopback/cloud-metadata IPs.
      const downloadUrl = await validatePublicUrl(videoUrl);
      const response = await fetch(downloadUrl);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('video/') && !contentType.startsWith('audio/')) {
        throw new Error(`Unexpected content type: ${contentType}. Expected video/audio.`);
      }
      // ponytail: stream-accumulate with a cap (the previous code loaded
      // the whole file via response.arrayBuffer() — 500MB video = 500MB heap).
      const MAX_DOWNLOAD_BYTES = 600 * 1024 * 1024;
      const chunks: Buffer[] = [];
      let received = 0;
      for await (const chunk of response.body!) {
        received += chunk.length;
        if (received > MAX_DOWNLOAD_BYTES) {
          throw new Error(`Download exceeds ${MAX_DOWNLOAD_BYTES} bytes`);
        }
        chunks.push(chunk as Buffer);
      }
      fs.writeFileSync(videoPath, Buffer.concat(chunks));
      await job.updateProgress(15);

      // Step 2: Normalize video format (transcode exotic codecs to H.264/AAC)
      if (dbJobId) {
        await supabase.from('jobs').update({ progress: 15 }).eq('id', dbJobId);
      }
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
      // ponytail: shell-free spawn; previous execAsync was template-string
      await runCommand(
        'ffmpeg',
        ['-i', safeVideoPath, '-vn', '-acodec', 'libmp3lame', '-ar', '16000', '-ab', '64k', '-y', safeAudioPath],
        60000,
      );

      // Step 4: Call Whisper API with word-level timestamps (with fallback)
      let transcription: any;
      try {
        // ponytail: OpenAI SDK has no client-side timeout — race against a
        // 60s ceiling so a hung request can't stall the worker indefinitely.
        const TIMEOUT_MS = 60_000;
        transcription = await Promise.race([
          this.openai.audio.transcriptions.create({
            file: fs.createReadStream(audioPath),
            model: 'whisper-1',
            response_format: 'verbose_json',
            timestamp_granularities: ['word'],
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Whisper timeout')), TIMEOUT_MS),
          ),
        ]);
      } catch (apiError: any) {
        console.warn(`[Transcription] OpenAI Whisper failed: ${apiError.message}. Falling back to local mode.`);
        // ponytail: local fallback uses ffmpeg silencedetect — produces
        // [Segmento N] placeholders with empty words. Marking completed
        // without this flag would let clip-analysis run on garbage and
        // return fake clips the user thinks are real analysis.
        transcription = await this.localTranscriptionFallback(audioPath, job);
        transcriptionDegraded = true;
      }

      if (dbJobId) {
        await supabase.from('jobs').update({ progress: 70 }).eq('id', dbJobId);
      }
      await job.updateProgress(70);

      // Step 5: Convert Whisper output to SubtitleSegment[]
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
          clip_id: null,
          segments,
          language: transcription.language || 'unknown',
        });

      if (subtitleError) {
        console.error(`[Transcription] Failed to persist subtitles: ${subtitleError.message}`);
      } else {
        console.log(`[Transcription] Persisted ${segments.length} segments to subtitles table`);
      }

      // Mark job as completed (with degraded flag if fallback was used)
      if (dbJobId) {
        await supabase
          .from('jobs')
          .update({
            status: 'completed',
            progress: 100,
            result: {
              segments_count: segments.length,
              degraded: transcriptionDegraded,
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', dbJobId);
      }

      // ponytail: skip clip-analysis when transcription is degraded.
      // Running it on [Segmento N] placeholders would produce fake clips.
      if (transcriptionDegraded) {
        console.warn(`[Transcription] Skipping clip-analysis due to degraded transcription`);
        await supabase.from('projects').update({ status: 'ready' }).eq('id', projectId);
        return { segments };
      }

      // Step 6: Enqueue clip-analysis job via injected queue
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
      throw new Error('Transcription failed');
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
      // ponytail: shell-free spawn; previous execAsync was template-string
      const { stdout } = await runCommand(
        'ffprobe',
        ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'default=noprint_wrappers=1:nokey=1', validateTempPath(inputPath)],
        15000,
      );
      const videoCodec = stdout.trim();

      let audioCodec = '';
      try {
        // ponytail: shell-free spawn; previous execAsync was template-string
        const { stdout: audioOut } = await runCommand(
          'ffprobe',
          ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'default=noprint_wrappers=1:nokey=1', validateTempPath(inputPath)],
          10000,
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

      // ponytail: shell-free spawn; previous execAsync was template-string
      await runCommand(
        'ffmpeg',
        ['-i', validateTempPath(inputPath), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-y', normalizedPath],
        300000,
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
    // ponytail: shell-free spawn; previous execAsync was template-string
    // ffmpeg silencedetect writes to stderr, not stdout — read .stderr.
    const { stderr } = await runCommand(
      'ffmpeg',
      ['-i', audioPath, '-af', 'silencedetect=n=-30dB:d=0.5', '-f', 'null', '-'],
      60000,
    );
    // Parse silence_start/silence_end from FFmpeg output
    const lines = stderr.split('\n');
    const silenceStarts: number[] = [];
    const silenceEnds: number[] = [];

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
