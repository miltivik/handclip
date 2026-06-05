import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JobStatusDto } from '@handclip/shared';
import { SupabaseService } from '../supabase/supabase.service';

interface AnalysisJob {
  projectId: string;
  userId: string;
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
  // Lightweight read cache (write-through from updateJobProgress)
  private progressCache = new Map<string, JobStatusDto>();

  constructor(
    @InjectQueue('transcription') private transcriptionQueue: Queue,
    @InjectQueue('clip-analysis') private clipAnalysisQueue: Queue,
    @InjectQueue('render') private renderQueue: Queue,
    private supabaseService: SupabaseService,
  ) {}

  async enqueueRender(data: {
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
    preset: 'tiktok' | 'reels' | 'shorts' | 'draft' | 'hq';
    clipId?: string;
    // speed: playback multiplier. Validated at API layer; worker should
    // defensively re-validate before passing to ffmpeg -filter:v "setpts=PTS/speed"
    speed?: 0.5 | 1 | 2;
    // textOverlay: optional burn-in subtitle text. Worker must validate
    // text.length <= 120 and position in ['top','center','bottom'] defensively.
    textOverlay?: { text: string; position: 'top' | 'center' | 'bottom' } | null;
  }) {
    const job = await this.renderQueue.add('render-video', data, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
    });

    const supabase = this.supabaseService.getServiceRoleClient();
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
      throw new Error(`Failed to insert render job into DB: ${error?.message}`);
    }

    return { jobId: jobsRow.id };
  }

  async enqueueAnalysis(projectId: string, userId: string, videoUrl: string) {
    const supabase = this.supabaseService.getServiceRoleClient();
    const { data: jobsRow, error } = await supabase
      .from('jobs')
      .insert({
        project_id: projectId,
        type: 'clip_analysis',
        status: 'queued',
        progress: 0,
        result: { pipeline: 'analysis' },
      })
      .select()
      .single();

    if (error || !jobsRow) {
      throw new Error(`Failed to insert analysis job into DB: ${error?.message}`);
    }

    const transcriptionJob = await this.transcriptionQueue.add(
      'transcribe',
      { projectId, userId, videoUrl, trackingJobId: jobsRow.id } as AnalysisJob & {
        trackingJobId: string;
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      },
    );
    const { error: updateError } = await supabase
      .from('jobs')
      .update({ bullmq_id: transcriptionJob.id as string })
      .eq('id', jobsRow.id);
    if (updateError) {
      throw new Error(`Failed to link analysis job to queue: ${updateError.message}`);
    }

    return {
      jobId: jobsRow.id,
      message: 'Transcription job queued. Clip analysis will start automatically.',
    };
  }

  async getJob(jobId: string): Promise<JobStatusDto> {
    const supabase = this.supabaseService.getServiceRoleClient();
    const { data: row, error } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (error || !row) {
      throw new Error(`Job ${jobId} not found`);
    }

    const jobsRow = row as JobsRow;

    // If queued or active, check BullMQ for real-time progress
    if (
      jobsRow.type !== 'clip_analysis' &&
      (jobsRow.status === 'queued' || jobsRow.status === 'active')
    ) {
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

  async getJobForUser(jobId: string, userId: string): Promise<JobStatusDto> {
    const supabase = this.supabaseService.getServiceRoleClient();
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select('project_id')
      .eq('id', jobId)
      .single();
    if (jobError || !job) {
      throw new NotFoundException('Job not found');
    }
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id')
      .eq('id', job.project_id)
      .eq('user_id', userId)
      .single();
    if (projectError || !project) {
      throw new NotFoundException('Job not found');
    }
    return this.getJob(jobId);
  }

  getJobProgress(jobId: string): JobStatusDto {
    const cached = this.progressCache.get(jobId);
    if (cached) return cached;

    // Cache miss — return pending status (async read from DB not possible in sync context)
    return {
      jobId,
      status: 'QUEUED',
      progress: 0,
    };
  }

  async updateJobProgress(jobId: string, status: JobStatusDto): Promise<void> {
    // Write-through cache
    this.progressCache.set(jobId, status);

    // Update DB
    const supabase = this.supabaseService.getServiceRoleClient();
    const updates: Partial<{
      status: string;
      progress: number;
      result: any;
      updated_at: string;
    }> = {
      progress: status.progress,
    };

    if (status.returnvalue !== undefined) {
      updates.result = status.returnvalue;
    }

    if (status.status) {
      updates.status = status.status.toLowerCase();
    }

    const { error } = await supabase
      .from('jobs')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    if (error) {
      console.error(`Failed to update job ${jobId} in DB: ${error.message}`);
    }
  }
}
