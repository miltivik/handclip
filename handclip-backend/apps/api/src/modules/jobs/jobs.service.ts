import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JobStatusDto, ExportPreset } from '@handclip/shared';
import { SupabaseService } from '../supabase/supabase.service';

interface AnalysisJob {
  projectId: string;
  videoUrl: string;
}

interface JobsRow {
  id: string;
  project_id: string;
  type: string;
  status: string;
  progress: number;
  result: any;
  bullmq_id: string;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class JobsService {

  constructor(
    @InjectQueue('transcription') private transcriptionQueue: Queue,
    @InjectQueue('clip-analysis') private clipAnalysisQueue: Queue,
    @InjectQueue('render') private renderQueue: Queue,
    private supabaseService: SupabaseService,
  ) {}

  async enqueueRender(token: string, data: {
    projectId: string;
    userId: string;
    videoUrl: string;
    trimStart: number;
    trimEnd: number;
    subtitles: any[];
    musicUrl?: string;
    musicVolume?: number;
    musicFadeIn?: number;
    musicFadeOut?: number;
    preset: ExportPreset;
    clipId?: string;
  }) {
    const supabase = this.supabaseService.getClientWithAuth(token);

    // Pre-create export record
    const { data: exportRow, error: exportError } = await supabase
      .from('exports')
      .insert({
        project_id: data.projectId,
        clip_id: data.clipId || null,
        preset: data.preset,
        status: 'queued',
      })
      .select('id')
      .single();

    if (exportError || !exportRow) {
      console.error('Failed to create export record:', exportError);
      throw new Error('Failed to create export record');
    }

    const job = await this.renderQueue.add('render-video', data, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 20 },
    });

    const { data: jobsRow, error } = await supabase
      .from('jobs')
      .insert({
        project_id: data.projectId,
        type: 'render',
        status: 'queued',
        progress: 0,
        bullmq_id: job.id as string,
      })
      .select()
      .single();

    if (error || !jobsRow) {
      console.error('Failed to insert render job:', error);
      throw new Error('Failed to create render job');
    }

    return { jobId: jobsRow.id, exportId: exportRow.id };
  }

  /**
   * Enqueues the full clip-finding pipeline:
   * 1. Transcription job → extracts audio, calls Whisper, persists subtitles
   * 2. Clip-analysis job → auto-enqueued by transcription processor upon completion
   *
   * Returns both job IDs so the frontend can track pipeline progress.
   * Poll `GET /jobs/:analysisJobId` to know when clips are ready.
   */
  async enqueueAnalysis(token: string, projectId: string, videoUrl: string) {
    const supabase = this.supabaseService.getClientWithAuth(token);

    // Enqueue transcription
    const transcriptionJob = await this.transcriptionQueue.add(
      'transcribe',
      { projectId, videoUrl } as AnalysisJob,
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    );

    // Pre-create transcription DB record
    const { data: transRow, error: transError } = await supabase
      .from('jobs')
      .insert({
        project_id: projectId,
        type: 'transcription',
        status: 'queued',
        progress: 0,
        bullmq_id: transcriptionJob.id as string,
      })
      .select('id')
      .single();

    if (transError || !transRow) {
      console.error('Failed to create transcription job:', transError);
      throw new Error('Failed to create transcription job');
    }

    // Pre-create clip-analysis DB record (status: queued until transcription finishes)
    const { data: analysisRow, error: analysisError } = await supabase
      .from('jobs')
      .insert({
        project_id: projectId,
        type: 'clip_analysis',
        status: 'queued',
        progress: 0,
        bullmq_id: null, // assigned when transcription enqueues it
      })
      .select('id')
      .single();

    if (analysisError || !analysisRow) {
      console.error('Failed to create clip-analysis job:', analysisError);
      throw new Error('Failed to create clip-analysis job');
    }

    return {
      transcriptionJobId: transRow.id,
      analysisJobId: analysisRow.id,
      message: 'Pipeline started: transcription → clip-analysis.',
    };
  }

  async getJob(jobId: string, userId: string, token?: string): Promise<JobStatusDto> {
    const supabase = token
      ? this.supabaseService.getClientWithAuth(token)
      : this.supabaseService.getClient();
    const { data: row, error } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (error || !row) {
      throw new Error(`Job ${jobId} not found`);
    }

    const jobsRow = row as JobsRow;

    // defense-in-depth: verify the job's project belongs to the caller
    if (jobsRow.project_id) {
      const { data: project } = await supabase
        .from('projects')
        .select('user_id')
        .eq('id', jobsRow.project_id)
        .single();
      if (!project || project.user_id !== userId) {
        // 404 not 403: don't leak existence
        throw new Error(`Job ${jobId} not found`);
      }
    }

    // If queued or active, check BullMQ for real-time progress
    if (jobsRow.status === 'queued' || jobsRow.status === 'active') {
      const queues = [this.transcriptionQueue, this.clipAnalysisQueue, this.renderQueue];
      for (const queue of queues) {
        const bullJob = await queue.getJob(jobsRow.bullmq_id);
        if (bullJob) {
          const bullState = await bullJob.getState();
          const bullProgress = bullJob.progress || 0;
          let bullStatus = jobsRow.status;
          if (bullState === 'completed') bullStatus = 'completed';
          else if (bullState === 'failed') bullStatus = 'failed';
          else if (bullState === 'active') bullStatus = 'active';

          return {
            jobId: jobsRow.id,
            status: bullStatus.toUpperCase(),
            progress: typeof bullProgress === 'number' ? bullProgress : 0,
            returnvalue: bullJob.returnvalue ?? jobsRow.result ?? undefined,
            failedReason: bullJob.failedReason ?? undefined,
          };
        }
      }
    }

    // Fallback to DB row
    const result = typeof jobsRow.result === 'string' ? JSON.parse(jobsRow.result) : jobsRow.result;
    return {
      jobId: jobsRow.id,
      status: jobsRow.status.toUpperCase(),
      progress: jobsRow.progress,
      returnvalue: result ?? undefined,
    };
  }
}