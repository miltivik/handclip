import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { SupabaseService } from '../modules/supabase/supabase.service';
import { incrementExportCount } from '../providers/export-counter';

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
  speed?: 0.5 | 1 | 2;
  textOverlay?: { text: string; position: 'top' | 'center' | 'bottom' } | null;
}

interface SubtitleSegment {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
  words?: { word: string; start: number; end: number; probability: number }[];
}

const PRESETS = {
  tiktok:   { width: 1080, height: 1920, videoBitrate: '8M',  audioBitrate: '128k', crf: 18, preset: 'fast' },
  reels:    { width: 1080, height: 1920, videoBitrate: '8M',  audioBitrate: '128k', crf: 18, preset: 'fast' },
  shorts:   { width: 1080, height: 1920, videoBitrate: '8M',  audioBitrate: '128k', crf: 18, preset: 'fast' },
  draft:    { width: 720,  height: 1280, videoBitrate: '2M',  audioBitrate: '96k',  crf: 28, preset: 'ultrafast' },
  hq:       { width: 1080, height: 1920, videoBitrate: '20M', audioBitrate: '256k', crf: 15, preset: 'slow' },
};
/** Escape text for FFmpeg drawtext filter */
export function escapeDrawtextText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')   // backslash first
    .replace(/'/g, "\\'")     // single quote
    .replace(/%/g, '%%')      // percent (FFmpeg expansion)
    .replace(/\r/g, ' ')      // CR -> space (prevent filtergraph break)
    .replace(/\n/g, ' ');     // LF -> space (prevent filtergraph break)
}
/** Map position to FFmpeg drawtext y coordinate */
export function getDrawtextY(position: string): string {
  switch (position) {
    case 'top':    return '80';
    case 'center': return '(h-text_h)/2';
    case 'bottom': return 'h-text_h-160'; // above subtitle margin
    default:       return 'h-text_h-160';
  }
}

@Processor('render')
export class RenderProcessor extends WorkerHost {
  constructor(private readonly supabaseService: SupabaseService) {
    super();
  }

  async process(job: Job<RenderJobData>): Promise<{ outputUrl: string }> {
    const { projectId, userId, videoUrl, trimStart, trimEnd, subtitles, musicUrl, musicVolume, musicFadeIn, musicFadeOut, preset, clipId } = job.data;
    const speed = (job.data.speed && [0.5, 1, 2].includes(job.data.speed)) ? job.data.speed : 1;
    const textOverlay = job.data.textOverlay || null;
    const config = PRESETS[preset] || PRESETS.tiktok;
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

    // Create export record in DB
    const { data: exportRecord, error: exportCreateError } = await supabase
      .from('exports')
      .insert({
        project_id: projectId,
        clip_id: clipId || null,
        preset,
        status: 'rendering',
      })
      .select('id')
      .single();

    if (exportCreateError) {
      console.error(`[Render] Failed to create export record: ${exportCreateError.message}`);
    }
    const dbExportId = exportRecord?.id;

    const tempDir = os.tmpdir();
    const musicPath = musicUrl ? path.join(tempDir, `${projectId}-music.mp3`) : null;
    const outputPath = path.join(tempDir, `${projectId}-output.mp4`);
    const inputPath = path.join(tempDir, `${projectId}-render-input.mp4`);
    const srtPath = path.join(tempDir, `${projectId}-subs.srt`);
    const thumbPath = path.join(tempDir, `${projectId}-thumb.jpg`);

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

    try {
      if (dbJobId) await supabase.from('jobs').update({ progress: 5 }).eq('id', dbJobId);
      await job.updateProgress(5);

      // Step 1: Download video
      if (videoUrl.startsWith('http')) {
        const res = await fetch(videoUrl);
        fs.writeFileSync(inputPath, Buffer.from(await res.arrayBuffer()));
      } else {
        fs.copyFileSync(videoUrl, inputPath);
      }

      if (dbJobId) await supabase.from('jobs').update({ progress: 15 }).eq('id', dbJobId);
      await job.updateProgress(15);

      // Step 2: Generate SRT subtitle file
      if (subtitles.length > 0) {
        const srt = this.generateSRT(subtitles);
        fs.writeFileSync(srtPath, srt);
      }

      // Step 3: Download music if provided
      if (musicUrl && musicPath) {
        const res = await fetch(musicUrl);
        fs.writeFileSync(musicPath, Buffer.from(await res.arrayBuffer()));
      }

      if (dbJobId) await supabase.from('jobs').update({ progress: 25 }).eq('id', dbJobId);
      await job.updateProgress(25);

      // Step 4: Build FFmpeg command
      const cmd = this.buildFFmpegCommand({
        inputPath,
        srtPath: subtitles.length > 0 ? srtPath : null,
        musicPath,
        trimStart,
        trimEnd,
        config,
        musicVolume,
        musicFadeIn,
        musicFadeOut,
        outputPath,
        speed,
        textOverlay,
      });
      if (dbJobId) await supabase.from('jobs').update({ progress: 30 }).eq('id', dbJobId);
      await job.updateProgress(30);
      console.log(`[Render] FFmpeg started for project ${projectId}, preset ${preset}, speed ${speed}`);


      // Step 5: Execute FFmpeg with codec fallback
      const codecFallbacks = [
        { codec: 'libx264', preset: config.preset, crf: config.crf },
        { codec: 'libx265', preset: 'fast', crf: 23 },       // H.265 fallback
        { codec: 'libx264', preset: 'ultrafast', crf: 28 },   // speed-over-quality fallback
      ];
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < codecFallbacks.length; attempt++) {
        const fb = codecFallbacks[attempt];
        const attemptCmd = this.buildFFmpegCommand({
          inputPath,
          srtPath: subtitles.length > 0 ? srtPath : null,
          musicPath,
          trimStart,
          trimEnd,
          config,
          musicVolume,
          musicFadeIn,
          musicFadeOut,
          outputPath,
          codec: fb.codec,
          preset: fb.preset,
          crf: fb.crf,
          speed,
          textOverlay,
        });
        try {
          await execAsync(attemptCmd, { timeout: 300000 });
          lastError = null;
          break;
        } catch (err: any) {
          lastError = err;
          console.warn(`[Render] FFmpeg attempt ${attempt + 1}/${codecFallbacks.length} failed: ${err.message}`);
        }
      }
      if (lastError) throw lastError;

      if (dbJobId) await supabase.from('jobs').update({ progress: 90 }).eq('id', dbJobId);
      await job.updateProgress(90);
      // Generate thumbnail at clip midpoint
      const midPoint = trimStart + (trimEnd - trimStart) / 2;
      let thumbnailUrl: string | null = null;
      try {
        await execAsync(
          `ffmpeg -ss ${midPoint} -i "${inputPath}" -vframes 1 -q:v 2 -y "${thumbPath}"`,
          { timeout: 10000 }
        );
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
        duration = (trimEnd - trimStart) / speed; // fallback accounts for speed
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
            thumbnail_url: thumbnailUrl,
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
      try {
        await fetch(`${API_BASE}/api/notifications/push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            title: '¡Tu clip está listo!',
            message: `El clip en formato ${preset} se ha exportado correctamente.`,
            data: { projectId, exportId: dbExportId, type: 'export_complete' },
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

      // Mark export as failed
      if (dbExportId) {
        await supabase
          .from('exports')
          .update({ status: 'failed' })
          .eq('id', dbExportId);
      }

      throw err;
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
      return `${i + 1}\n${start} --> ${end}\n${seg.text}\n`;
    }).join('\n');
  }

  private formatSRTTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }

  /** Construir comando FFmpeg completo */
  private buildFFmpegCommand(opts: {
    inputPath: string;
    srtPath: string | null;
    musicPath: string | null;
    trimStart: number;
    trimEnd: number;
    config: typeof PRESETS.tiktok;
    musicVolume?: number;
    musicFadeIn?: number;
    musicFadeOut?: number;
    outputPath: string;
    codec?: string;
    preset?: string;
    crf?: number;
    speed?: number;
    textOverlay?: { text: string; position: string } | null;
  }): string {
    const { inputPath, srtPath, musicPath, trimStart, trimEnd, config, musicVolume, musicFadeIn, musicFadeOut, outputPath, codec, preset, crf, speed = 1, textOverlay = null } = opts;
    const duration = trimEnd - trimStart;
    const outputDuration = duration / speed;
    // Filter chain for video
    const videoFilters: string[] = [];

    // Trim
    videoFilters.push(`trim=start=${trimStart}:duration=${duration},setpts=PTS-STARTPTS`);
    // Speed adjustment
    if (speed !== 1) {
      videoFilters.push(`setpts=PTS/${speed}`);
    }
    // Scale + crop to 9:16
    videoFilters.push(`scale=${config.width}:${config.height}:force_original_aspect_ratio=increase`);
    videoFilters.push(`crop=${config.width}:${config.height}`);
    videoFilters.push(`setsar=1`);
    // Text overlay (before subtitles so subtitles render on top)
    if (textOverlay && textOverlay.text) {
      const escaped = escapeDrawtextText(textOverlay.text);
      const y = getDrawtextY(textOverlay.position);
      videoFilters.push(`drawtext=text='${escaped}':x=(w-text_w)/2:y=${y}:fontcolor=white:fontsize=56:borderw=3:bordercolor=black`);
    }
    // Subtitle overlay
    if (srtPath) {
      videoFilters.push(`subtitles='${srtPath}':force_style='Fontname=Arial,Fontsize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Shadow=1,MarginV=40'`);
    }

    const videoFilterStr = videoFilters.join(',');

    // Build the full command
    let cmd = `ffmpeg -i "${inputPath}"`;

    // Add music input if provided
    if (musicPath) {
      cmd += ` -i "${musicPath}"`;
    }

    // Filter complex
    const filterParts: string[] = [];
    filterParts.push(`[0:v]${videoFilterStr}[vout]`);

    // Audio: trim original audio
    const fadeOutStart = Math.max(0, outputDuration - 0.5);
    let audioChain = `atrim=start=${trimStart}:duration=${duration},asetpts=PTS-STARTPTS`;
    if (speed !== 1) {
      audioChain += `,atempo=${speed}`;
    }
    audioChain += `,afade=t=in:st=0:d=0.1,afade=t=out:st=${fadeOutStart}:d=0.5`;
    filterParts.push(`[0:a]${audioChain}[vaudio]`);
    if (musicPath && musicVolume !== undefined) {
      // Music processing
      let musicChain = `[1:a]atrim=start=0:duration=${duration},asetpts=PTS-STARTPTS`;
      // Volume (0-200%, default 30% when there's voice)
      const vol = musicVolume !== undefined ? musicVolume / 100 : 0.3;
      musicChain += `,volume=${vol}`;
      // Fade - use outputDuration for timing
      musicChain += `,afade=t=in:st=0:d=${musicFadeIn || 0.5}`;
      musicChain += `,afade=t=out:st=${outputDuration - (musicFadeOut || 0.5)}:d=${musicFadeOut || 0.5}`;
      musicChain += `[m audio]`;
      filterParts.push(musicChain);


      // Mix voice + music
      filterParts.push(`[vaudio][m audio]amix=inputs=2:duration=first:dropout_transition=2,volume=1.2[aout]`);
    } else {
      filterParts.push(`[vaudio]volume=1.0[aout]`);
    }

    cmd += ` -filter_complex "${filterParts.join(';')}"`;
    cmd += ` -map "[vout]" -map "[aout]"`;
    const finalCodec = codec || 'libx264';
    const finalPreset = preset || config.preset;
    const finalCrf = crf !== undefined ? crf : config.crf;
    cmd += ` -c:v ${finalCodec} -preset ${finalPreset} -crf ${finalCrf}`;
    // Robust bitrate parsing: handle both '8M' and '8000k' formats
    const bitrateNum = parseInt(config.videoBitrate.replace(/[^0-9]/g, ''), 10);
    cmd += ` -maxrate ${config.videoBitrate} -bufsize ${bitrateNum * 2}k`;
    cmd += ` -pix_fmt yuv420p`;
    cmd += ` -c:a aac -b:a ${config.audioBitrate} -ar 48000`;
    cmd += ` -movflags +faststart`;
    cmd += ` -y "${outputPath}"`;

    return cmd;
  }
}
