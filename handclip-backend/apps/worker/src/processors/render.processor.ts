import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../modules/supabase/supabase.service';
import { incrementExportCount } from '../providers/export-counter';
import { validateTempPath } from '../utils/validate-path';
import { EXPORT_PRESETS, MIN_CLIP_DURATION_SEC, MAX_CLIP_DURATION_SEC, validatePublicUrl } from '@handclip/shared';
const execAsync = promisify(exec);
interface RenderJobData {
  projectId: string;
  userId: string;
  videoUrl: string;
  trimStart: number;
  trimEnd: number;
  subtitles: SubtitleSegment[];
  musicUrl?: string;
  musicVolume?: number;
  musicFadeIn?: number;
  musicFadeOut?: number;
  preset: 'tiktok' | 'reels' | 'shorts' | 'draft' | 'hq';
  clipId?: string;
}

interface SubtitleSegment {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
  words?: { word: string; start: number; end: number; probability: number }[];
}


@Processor('render', { lockDuration: 600000, lockRenewTime: 30000 })
export class RenderProcessor extends WorkerHost {
  constructor(private readonly supabaseService: SupabaseService) {
    super();
  }

  async process(job: Job<RenderJobData>): Promise<{ outputUrl: string }> {
    const { projectId, userId, videoUrl, trimStart, trimEnd, subtitles, musicUrl, musicVolume, musicFadeIn, musicFadeOut, preset, clipId } = job.data;
    const config = EXPORT_PRESETS[preset] || EXPORT_PRESETS.tiktok;
    const supabase = this.supabaseService.getServiceRoleClient();

    // Create job record in DB
    const { data: jobRecord, error: jobCreateError } = await supabase
      .from('jobs')
      .insert({
        project_id: projectId,
        type: 'render',
        status: 'active',
        progress: 5,
        bullmq_id: job.id,
      })
      .select('id')
      .single();

    if (jobCreateError) {
      console.error(`[Render] Failed to create job record: ${jobCreateError.message}`);
    }
    const dbJobId = jobRecord?.id;
    // Look up pre-created export record (from enqueueRender)
    const { data: exportRecord } = await supabase
      .from('exports')
      .select('id')
      .eq('project_id', projectId)
      .eq('status', 'queued')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    let dbExportId: string | undefined;
    if (!exportRecord) {
      // Fallback: create export record
      const { data: newExport } = await supabase
        .from('exports')
        .insert({ project_id: projectId, clip_id: clipId || null, preset, status: 'rendering' })
        .select('id')
        .single();
      dbExportId = newExport?.id;
    } else {
      dbExportId = exportRecord.id;
      await supabase.from('exports').update({ status: 'rendering' }).eq('id', dbExportId);
    }

    const tempDir = os.tmpdir();
    const musicPath = musicUrl ? path.join(tempDir, `${projectId}-music.mp3`) : null;
    const outputPath = path.join(tempDir, `${projectId}-output.mp4`);
    const inputPath = path.join(tempDir, `${projectId}-render-input.mp4`);
    const srtPath = path.join(tempDir, `${projectId}-subs.srt`);
    const thumbPath = path.join(tempDir, `${projectId}-thumb.jpg`);

    // Validate all temp paths before passing to FFmpeg
    validateTempPath(inputPath);
    validateTempPath(outputPath);
    validateTempPath(srtPath);
    validateTempPath(thumbPath);
    if (musicPath) validateTempPath(musicPath);
    // Check export limit for free tier (3/month)
    const { allowed, count } = await incrementExportCount(userId, supabase);
    if (!allowed) {
      const err = new Error(`Límite de exports alcanzado (${count}/3 este mes). Actualiza a Pro.`);
      if (dbJobId) {
        await supabase.from('jobs').update({ status: 'failed', result: { error: err.message }, updated_at: new Date().toISOString() }).eq('id', dbJobId);
      }
      if (dbExportId) {
        await supabase.from('exports').update({ status: 'failed' }).eq('id', dbExportId);
      }
      throw err;
    }

    // Pre-flight validation: trim duration
    const clipDuration = trimEnd - trimStart;
    if (clipDuration < MIN_CLIP_DURATION_SEC) {
      const err = new Error(`Clip demasiado corto (${clipDuration.toFixed(1)}s). Mínimo: ${MIN_CLIP_DURATION_SEC}s`);
      await this.failJob(dbJobId, dbExportId, supabase, err.message);
      throw err;
    }
    if (clipDuration > MAX_CLIP_DURATION_SEC) {
      const err = new Error(`Clip demasiado largo (${clipDuration.toFixed(1)}s). Máximo: ${MAX_CLIP_DURATION_SEC}s`);
      await this.failJob(dbJobId, dbExportId, supabase, err.message);
      throw err;
    }

    if (trimStart >= trimEnd) {
      const err = new Error(`trimStart (${trimStart}) debe ser menor que trimEnd (${trimEnd})`);
      await this.failJob(dbJobId, dbExportId, supabase, err.message);
      throw err;
    }

    try {
      await job.updateProgress(5);
      // Step 1: Download video
      let downloadUrl: string;
      if (videoUrl.startsWith('http')) {
        downloadUrl = await validatePublicUrl(videoUrl);
      } else {
        downloadUrl = videoUrl; // local file path
      }

      if (downloadUrl.startsWith('http')) {
        const res = await fetch(downloadUrl);
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.startsWith('video/') && !contentType.startsWith('audio/')) {
          throw new Error(`Unexpected content type: ${contentType}. Expected video/audio.`);
        }
        fs.writeFileSync(inputPath, Buffer.from(await res.arrayBuffer()));
      } else {
        fs.copyFileSync(downloadUrl, inputPath);
      }
      await job.updateProgress(15);

      // Step 2: Generate SRT subtitle file
      if (subtitles.length > 0) {
        const srt = this.generateSRT(subtitles);
        fs.writeFileSync(srtPath, srt);
      }

      // Step 3: Download music if provided
      if (musicUrl && musicPath) {
        const safeMusicUrl = await validatePublicUrl(musicUrl);
        const res = await fetch(safeMusicUrl);
        fs.writeFileSync(musicPath, Buffer.from(await res.arrayBuffer()));
      }

      await job.updateProgress(25);

      // Step 5: Execute FFmpeg with codec fallback (2 levels, no H.265)
      // Uses spawn for granular stderr-based progress
      const codecFallbacks = [
        { codec: 'libx264', preset: config.preset, crf: config.crf },
        { codec: 'libx264', preset: 'ultrafast', crf: 28 },
      ];
      let lastError: Error | null = null;

      for (let attempt = 0; attempt < codecFallbacks.length; attempt++) {
        const fb = codecFallbacks[attempt];
        const attemptArgs = this.buildFFmpegCommand({
          inputPath, srtPath: subtitles.length > 0 ? srtPath : null,
          musicPath, trimStart, trimEnd, config,
          musicVolume, musicFadeIn, musicFadeOut, outputPath,
          codec: fb.codec, preset: fb.preset, crf: fb.crf,
        });

        try {
          await this.runFFmpegWithProgress(attemptArgs, clipDuration, job, dbJobId, supabase);
          lastError = null;
          break;
        } catch (err: any) {
          lastError = err;
          console.warn(`[Render] FFmpeg attempt ${attempt + 1}/${codecFallbacks.length} failed: ${err.message}`);
        }
      }
      if (lastError) throw lastError;

      await job.updateProgress(90);
      // Generate thumbnail at clip midpoint
      const midPoint = trimStart + (trimEnd - trimStart) / 2;
      let thumbnailUrl: string | null = null;
      try {
        await new Promise<void>((resolve, reject) => {
          const child = spawn('ffmpeg', [
            '-ss', String(midPoint),
            '-i', inputPath,
            '-vframes', '1',
            '-q:v', '2',
            '-y', thumbPath,
          ], { timeout: 10000 });
          child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Thumbnail ffmpeg exited with code ${code}`));
          });
          child.on('error', reject);
        });
        // Upload thumbnail to Supabase Storage
        const thumbBuffer = fs.readFileSync(thumbPath);
        const thumbStoragePath = `${projectId}/${preset}/thumbnail.jpg`;
        const { error: thumbError } = await supabase.storage
          .from('thumbnails')
          .upload(thumbStoragePath, thumbBuffer, {
            contentType: 'image/jpeg',
            upsert: true,
          });
        if (!thumbError) {
          const { data: thumbSigned } = await supabase.storage
            .from('thumbnails')
            .createSignedUrl(thumbStoragePath, 7 * 24 * 3600);
          thumbnailUrl = thumbSigned?.signedUrl || null;
        }
      } catch (thumbErr: any) {
        console.warn(`[Render] Thumbnail generation failed (non-blocking): ${thumbErr.message}`);
      }

      // Step 6: Upload to Supabase Storage
      const storagePath = `${projectId}/${preset}/output.mp4`;
      const fileBuffer = fs.readFileSync(outputPath);
      const fileSize = fileBuffer.length;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('exports')
        .upload(storagePath, fileBuffer, {
          contentType: 'video/mp4',
          upsert: true,
        });

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      // Generate signed URL (valid 7 days)
      const { data: signedData } = await supabase.storage
        .from('exports')
        .createSignedUrl(storagePath, 7 * 24 * 3600);

      const outputUrl = signedData?.signedUrl || storagePath;

      // Get video duration for export record
      let duration: number | null = null;
      try {
        const { stdout } = await execAsync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outputPath}"`
        );
        duration = parseFloat(stdout.trim()) || null;
      } catch {
        duration = trimEnd - trimStart; // fallback
      }

      // Update export record
      if (dbExportId) {
        await supabase
          .from('exports')
          .update({
            status: 'completed',
            output_url: outputUrl,
            file_size: fileSize,
            duration,
            completed_at: new Date().toISOString(),
          })
          .eq('id', dbExportId);
      }

      // Update clip status if clipId provided
      if (clipId) {
        await supabase
          .from('clips')
          .update({ status: 'exported', user_edited: true })
          .eq('id', clipId);
      }

      // Mark job as completed
      if (dbJobId) {
        await supabase
          .from('jobs')
          .update({
            status: 'completed',
            progress: 100,
            result: { output_url: outputUrl, export_id: dbExportId },
            updated_at: new Date().toISOString(),
          })
          .eq('id', dbJobId);
      }

      // Send push notification
      const API_BASE = process.env.API_URL || 'http://localhost:3000';
      const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';
      try {
        await fetch(`${API_BASE}/api/notifications/push`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(INTERNAL_API_KEY ? { 'X-Internal-API-Key': INTERNAL_API_KEY } : {}),
          },
          body: JSON.stringify({
            userId,
            title: '¡Tu clip está listo!',
            message: `El clip en formato ${preset} se ha exportado correctamente.`,
            data: { projectId, exportId: dbExportId, type: 'export_complete', deepLink: `handclip://project/${projectId}/export?exportId=${dbExportId}` },
          }),
        });
      } catch (err: any) {
        console.warn(`[Render] Push notification failed (non-blocking): ${err.message}`);
      }

      await job.updateProgress(100);
      console.log(`[Render] Completed for project ${projectId}`);

      return { outputUrl };
    } catch (err: any) {
      console.error(`[Render] Failed for project ${projectId}: ${err.message}`);

      // Mark job as failed. Log full error server-side, store generic
      // message in DB so the API doesn't leak internal paths/state
      // (FFmpeg errors commonly include /tmp/<uuid> paths, codec names,
      // and env hints).
      if (dbJobId) {
        await supabase
          .from('jobs')
          .update({
            status: 'failed',
            progress: 0,
            result: { error: 'Render failed. See server logs for details.' },
            updated_at: new Date().toISOString(),
          })
          .eq('id', dbJobId);
      }

      // Mark export as failed
      if (dbExportId) {
        await supabase
          .from('exports')
          .update({ status: 'failed' })
          .eq('id', dbExportId);
      }
      throw new Error('Render failed');
    } finally {
      // Cleanup temp files
      for (const f of [inputPath, srtPath, musicPath, outputPath]) {
        if (f) try { fs.unlinkSync(f); } catch {}
      }
      // Cleanup thumbnail
      if (thumbPath) try { fs.unlinkSync(thumbPath); } catch {}
    }
  }

  /** Generar archivo SRT a partir de SubtitleSegment[] */
  private generateSRT(segments: SubtitleSegment[]): string {
    return segments.map((seg, i) => {
      const start = this.formatSRTTime(seg.startTime);
      const end = this.formatSRTTime(seg.endTime);
      const safeText = seg.text
        .replace(/-->/g, '→')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
        .substring(0, 500);
      return `${i + 1}\n${start} --> ${end}\n${safeText}\n`;
    }).join('\n');
  }

  private formatSRTTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }

  /** Construir comando FFmpeg completo — devuelve array de argumentos para spawn */
  private buildFFmpegCommand(opts: {
    inputPath: string;
    srtPath: string | null;
    musicPath: string | null;
    trimStart: number;
    trimEnd: number;
    config: (typeof EXPORT_PRESETS)[keyof typeof EXPORT_PRESETS];
    musicVolume?: number;
    musicFadeIn?: number;
    musicFadeOut?: number;
    outputPath: string;
    codec?: string;
    preset?: string;
    crf?: number;
  }): string[] {
    const { inputPath, srtPath, musicPath, trimStart, trimEnd, config, musicVolume, musicFadeIn, musicFadeOut, outputPath, codec, preset, crf } = opts;
    const duration = trimEnd - trimStart;

    const videoFilters: string[] = [];

    // Trim
    videoFilters.push(`trim=start=${trimStart}:duration=${duration},setpts=PTS-STARTPTS`);

    // Scale + crop to 9:16
    videoFilters.push(`scale=${config.width}:${config.height}:force_original_aspect_ratio=increase`);
    videoFilters.push(`crop=${config.width}:${config.height}`);
    videoFilters.push(`setsar=1`);

    // Subtitle overlay
    if (srtPath) {
      videoFilters.push(`subtitles='${srtPath}':force_style='Fontname=Arial,Fontsize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Shadow=1,MarginV=40'`);
    }

    const videoFilterStr = videoFilters.join(',');

    const args: string[] = [];
    args.push('-i', inputPath);
    if (musicPath) args.push('-i', musicPath);

    // Filter complex — [0:a]? for optional audio (won't fail on silent video)
    const filterParts: string[] = [];
    filterParts.push(`[0:v]${videoFilterStr}[vout]`);

    const fadeOutStart = Math.max(0, duration - 0.5);
    filterParts.push(`[0:a]?atrim=start=${trimStart}:duration=${duration},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.1,afade=t=out:st=${fadeOutStart}:d=0.5[vaudio]`);

    if (musicPath && musicVolume !== undefined) {
      let musicChain = `[1:a]atrim=start=0:duration=${duration},asetpts=PTS-STARTPTS`;
      const vol = musicVolume / 100;
      musicChain += `,volume=${vol}`;
      musicChain += `,afade=t=in:st=0:d=${musicFadeIn || 0.5}`;
      musicChain += `,afade=t=out:st=${duration - (musicFadeOut || 0.5)}:d=${musicFadeOut || 0.5}`;
      musicChain += `[maudio]`;
      filterParts.push(musicChain);
      filterParts.push(`[vaudio][maudio]amix=inputs=2:duration=first:dropout_transition=2,volume=1.2[aout]`);
    } else {
      filterParts.push(`[vaudio]volume=1.0[aout]`);
    }

    args.push('-filter_complex', filterParts.join(';'));
    args.push('-map', '[vout]', '-map', '[aout]');

    const finalCodec = codec || 'libx264';
    const finalPreset = preset || config.preset;
    const finalCrf = crf !== undefined ? crf : config.crf;

    args.push('-c:v', finalCodec, '-preset', finalPreset, '-crf', String(finalCrf));
    const bitrateNum = parseInt(config.videoBitrate.replace(/[^0-9]/g, ''), 10);
    args.push('-maxrate', config.videoBitrate, '-bufsize', `${bitrateNum * 2}k`);
    args.push('-pix_fmt', 'yuv420p');
    args.push('-c:a', 'aac', '-b:a', config.audioBitrate, '-ar', '48000');
    args.push('-movflags', '+faststart');
    args.push('-y', outputPath);

    return args;
  }
  /** Execute FFmpeg via spawn, extracting progress from stderr time= lines */
  private runFFmpegWithProgress(
    args: string[],
    totalDuration: number,
    job: Job<RenderJobData>,
    dbJobId: string | undefined,
    supabase: SupabaseClient,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('ffmpeg', args, { timeout: 300000 });

      let stderr = '';

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
        const match = data.toString().match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (match && totalDuration > 0) {
          const seconds =
            parseInt(match[1], 10) * 3600 +
            parseInt(match[2], 10) * 60 +
            parseFloat(match[3]);
          const progress = Math.min(90, Math.round(30 + (seconds / totalDuration) * 60));
          job.updateProgress(progress).catch(() => {});
        }
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
        }
      });

      child.on('error', (err) => {
        reject(new Error(`FFmpeg spawn failed: ${err.message}`));
      });
    });
  }

  /** Mark both job and export as failed */
  private async failJob(
    dbJobId: string | undefined,
    dbExportId: string | undefined,
    supabase: SupabaseClient,
    errorMessage: string,
  ): Promise<void> {
    if (dbJobId) {
      await supabase
        .from('jobs')
        .update({ status: 'failed', result: { error: errorMessage }, updated_at: new Date().toISOString() })
        .eq('id', dbJobId);
    }
    if (dbExportId) {
      await supabase.from('exports').update({ status: 'failed' }).eq('id', dbExportId);
    }
  }
}
