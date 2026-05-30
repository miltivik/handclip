import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createClient } from '@supabase/supabase-js';
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

@Processor('render')
export class RenderProcessor extends WorkerHost {
  async process(job: Job<RenderJobData>): Promise<{ outputUrl: string }> {
    const { projectId, userId, videoUrl, trimStart, trimEnd, subtitles, musicUrl, musicVolume, musicFadeIn, musicFadeOut, preset } = job.data;
    const config = PRESETS[preset] || PRESETS.tiktok;

    const tempDir = os.tmpdir();
    const musicPath = musicUrl ? path.join(tempDir, `${projectId}-music.mp3`) : null;
    const outputPath = path.join(tempDir, `${projectId}-output.mp4`);
    const inputPath = path.join(tempDir, `${projectId}-render-input.mp4`);
    const srtPath = path.join(tempDir, `${projectId}-subs.srt`);

    // Check export limit for free tier (3/month)
    const { allowed, count } = await incrementExportCount(userId);
    if (!allowed) throw new Error(`Límite de exports alcanzado (${count}/3 este mes). Actualiza a Pro.`);

    try {
      await job.updateProgress(5);

      // Step 1: Download video
      if (videoUrl.startsWith('http')) {
        const res = await fetch(videoUrl);
        fs.writeFileSync(inputPath, Buffer.from(await res.arrayBuffer()));
      } else {
        fs.copyFileSync(videoUrl, inputPath);
      }

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
      });

      await job.updateProgress(30);
      console.log(`[Render] FFmpeg: ${cmd}`);

      // Step 5: Execute FFmpeg
      await execAsync(cmd, { timeout: 300000 }); // 5 min timeout

      await job.updateProgress(90);
      // Step 6: Upload to Supabase Storage
      const supabase = createClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || ''
      );

      const storagePath = `${projectId}/${preset}/output.mp4`;
      const fileBuffer = fs.readFileSync(outputPath);
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

      await job.updateProgress(100);
      console.log(`[Render] Completed for project ${projectId}`);

      return { outputUrl };
    } finally {
      // Cleanup temp files
      for (const f of [inputPath, srtPath, musicPath]) {
        if (f) try { fs.unlinkSync(f); } catch {}
      }
      // Keep output file — it gets uploaded or served
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
  }): string {
    const { inputPath, srtPath, musicPath, trimStart, trimEnd, config, musicVolume, musicFadeIn, musicFadeOut, outputPath } = opts;
    const duration = trimEnd - trimStart;

    // Filter chain for video
    const videoFilters: string[] = [];

    // Trim
    videoFilters.push(`trim=start=${trimStart}:duration=${duration},setpts=PTS-STARTPTS`);

    // Scale + crop to 9:16
    videoFilters.push(`scale=${config.width}:${config.height}:force_original_aspect_ratio=increase`);
    videoFilters.push(`crop=${config.width}:${config.height}`);
    videoFilters.push(`setsar=1`);

    // Subtitle overlay
    if (srtPath) {
      // Linux: FFmpeg subtitles filter with single-quoted path (no escaping needed)
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
    const fadeOutStart = Math.max(0, duration - 0.5);
    filterParts.push(`[0:a]atrim=start=${trimStart}:duration=${duration},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.1,afade=t=out:st=${fadeOutStart}:d=0.5[vaudio]`);

    if (musicPath && musicVolume !== undefined) {
      // Music processing
      let musicChain = `[1:a]atrim=start=0:duration=${duration},asetpts=PTS-STARTPTS`;

      // Volume (0-200%, default 30% when there's voice)
      const vol = musicVolume !== undefined ? musicVolume / 100 : 0.3;
      musicChain += `,volume=${vol}`;

      // Fade
      musicChain += `,afade=t=in:st=0:d=${musicFadeIn || 0.5}`;
      musicChain += `,afade=t=out:st=${duration - (musicFadeOut || 0.5)}:d=${musicFadeOut || 0.5}`;
      musicChain += `[m audio]`;
      filterParts.push(musicChain);

      // Mix voice + music
      filterParts.push(`[vaudio][m audio]amix=inputs=2:duration=first:dropout_transition=2,volume=1.2[aout]`);
    } else {
      filterParts.push(`[vaudio]volume=1.0[aout]`);
    }

    cmd += ` -filter_complex "${filterParts.join(';')}"`;
    cmd += ` -map "[vout]" -map "[aout]"`;
    cmd += ` -c:v libx264 -preset ${config.preset} -crf ${config.crf}`;
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