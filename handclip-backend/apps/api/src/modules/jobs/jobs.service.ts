import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ActiveJobDto, JobStatusDto } from '@handclip/shared';
import { SupabaseService } from '../supabase/supabase.service';

interface AnalysisJobData {
  projectId: string;
  userId: string;
  sourceVideoPath: string;
  // Backward-compat: older queue payloads used a 1h signed URL.
  videoUrl?: string;
  trackingJobId: string;
}

interface RenderJobDataBase {
  projectId: string;
  userId: string;
  sourceVideoPath: string;
  videoUrl?: string; // legacy
  trimStart: number;
  trimEnd: number;
  subtitles: any[];
  musicUrl?: string;
  musicVolume?: number;
  musicFadeIn?: number;
  musicFadeOut?: number;
  preset: 'tiktok' | 'reels' | 'shorts' | 'draft' | 'hq';
  clipId?: string;
  speed?: 0.5 | 1 | 2;
  textOverlay?: { text: string; position: 'top' | 'center' | 'bottom' } | null;
}

interface JobsRow {
  id: string;
  project_id: string;
  user_id: string | null;
  type: string;
  status: string;
  progress: number;
  result: any;
  bullmq_id: string | null;
  client_request_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnqueueRenderInput {
  projectId: string;
  userId: string;
  sourceVideoPath: string;
  trimStart: number;
  trimEnd: number;
  subtitles: any[];
  musicUrl?: string;
  musicVolume?: number;
  musicFadeIn?: number;
  musicFadeOut?: number;
  preset: 'tiktok' | 'reels' | 'shorts' | 'draft' | 'hq';
  clipId?: string;
  speed?: 0.5 | 1 | 2;
  textOverlay?: { text: string; position: 'top' | 'center' | 'bottom' } | null;
  clientRequestId?: string;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class TtlMap<T> {
  private store = new Map<string, CacheEntry<T>>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

@Injectable()
export class JobsService {
  // Transient cache for job progress lookups; TTL avoids unbounded growth.
  private progressCache = new TtlMap<JobStatusDto>(30_000);

  constructor(
    @InjectQueue('transcription') private transcriptionQueue: Queue,
    @InjectQueue('clip-analysis') private clipAnalysisQueue: Queue,
    @InjectQueue('render') private renderQueue: Queue,
    @InjectQueue('edit-prompt') private editPromptQueue: Queue,
    private supabaseService: SupabaseService,
  ) {}

  // ---------------------------------------------------------------------------
  // Idempotent enqueue
  // ---------------------------------------------------------------------------

  async enqueueRender(input: EnqueueRenderInput): Promise<{ jobId: string }> {
    const { clientRequestId, ...data } = input;

    const existing = await this.findExistingJob(
      data.userId,
      'render',
      clientRequestId,
    );
    if (existing) {
      return { jobId: existing.id };
    }

    const supabase = this.supabaseService.getServiceRoleClient();
    const { data: jobsRow, error } = await supabase
      .from('jobs')
      .insert({
        project_id: data.projectId,
        user_id: data.userId,
        type: 'render',
        status: 'queued',
        progress: 0,
        client_request_id: clientRequestId ?? null,
      })
      .select()
      .single();

    if (error || !jobsRow) {
      if (clientRequestId) {
        const race = await this.findExistingJob(
          data.userId,
          'render',
          clientRequestId,
        );
        if (race) return { jobId: race.id };
      }
      throw new Error(`Failed to insert render job into DB: ${error?.message}`);
    }

    try {
      const job = await this.renderQueue.add(
        'render-video',
        { ...data, trackingJobId: jobsRow.id } as RenderJobDataBase & { trackingJobId: string },
        { attempts: 2, backoff: { type: 'exponential', delay: 5000 } },
      );

      const { error: linkError } = await supabase
        .from('jobs')
        .update({ bullmq_id: job.id as string })
        .eq('id', jobsRow.id);
      if (linkError) {
        await this.markJobFailed(jobsRow.id, `Failed to link render job to queue: ${linkError.message}`);
        throw new Error(`Failed to link render job to queue: ${linkError.message}`);
      }

      return { jobId: jobsRow.id };
    } catch (err: any) {
      // queue.add or the bullmq_id link failed: the row exists with no
      // valid queue backing. Mark it failed so the client doesn't sit on
      // a perpetual "queued" status.
      await this.markJobFailed(
        jobsRow.id,
        `Failed to enqueue render job: ${err?.message ?? String(err)}`,
      );
      throw err;
    }
  }

  async enqueueAnalysis(
    projectId: string,
    userId: string,
    sourceVideoPath: string,
    clientRequestId?: string,
  ): Promise<{ jobId: string; message?: string }> {
    const existing = await this.findExistingJob(
      userId,
      'clip_analysis',
      clientRequestId,
    );
    if (existing) {
      return { jobId: existing.id };
    }

    const supabase = this.supabaseService.getServiceRoleClient();
    const { data: jobsRow, error } = await supabase
      .from('jobs')
      .insert({
        project_id: projectId,
        user_id: userId,
        type: 'clip_analysis',
        status: 'queued',
        progress: 0,
        result: { pipeline: 'analysis' },
        client_request_id: clientRequestId ?? null,
      })
      .select()
      .single();

    if (error || !jobsRow) {
      if (clientRequestId) {
        const race = await this.findExistingJob(
          userId,
          'clip_analysis',
          clientRequestId,
        );
        if (race) return { jobId: race.id };
      }
      throw new Error(`Failed to insert analysis job into DB: ${error?.message}`);
    }

    try {
      const transcriptionJob = await this.transcriptionQueue.add(
        'transcribe',
        { projectId, userId, sourceVideoPath, trackingJobId: jobsRow.id } as AnalysisJobData,
        { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
      );

      const { error: updateError } = await supabase
        .from('jobs')
        .update({ bullmq_id: transcriptionJob.id as string })
        .eq('id', jobsRow.id);
      if (updateError) {
        await this.markJobFailed(
          jobsRow.id,
          `Failed to link analysis job to queue: ${updateError.message}`,
        );
        throw new Error(`Failed to link analysis job to queue: ${updateError.message}`);
      }

      return {
        jobId: jobsRow.id,
        message: 'Transcription job queued. Clip analysis will start automatically.',
      };
    } catch (err: any) {
      await this.markJobFailed(
        jobsRow.id,
        `Failed to enqueue analysis job: ${err?.message ?? String(err)}`,
      );
      throw err;
    }
  }

  async enqueueEditPrompt(
    projectId: string,
    userId: string,
    prompt: string,
    clientRequestId?: string,
  ): Promise<{ jobId: string }> {
    const existing = await this.findExistingJob(
      userId,
      'edit_prompt',
      clientRequestId,
    );
    if (existing) return { jobId: existing.id };

    const supabase = this.supabaseService.getServiceRoleClient();
    const { data: jobsRow, error } = await supabase
      .from('jobs')
      .insert({
        project_id: projectId,
        user_id: userId,
        type: 'edit_prompt',
        status: 'queued',
        progress: 0,
        result: { prompt, notImplemented: true },
        client_request_id: clientRequestId ?? null,
      })
      .select()
      .single();

    if (error || !jobsRow) {
      if (clientRequestId) {
        const race = await this.findExistingJob(
          userId,
          'edit_prompt',
          clientRequestId,
        );
        if (race) return { jobId: race.id };
      }
      throw new Error(`Failed to insert edit-prompt job: ${error?.message}`);
    }

    // Don't enqueue the queue job: edit-prompt is not yet implemented.
    // Mark the job as failed so the client (and resume logic) sees a
    // terminal state immediately and shows "Función aún no disponible".
    await this.markJobFailed(
      jobsRow.id,
      'La edición por prompt aún no está disponible.',
    );
    return { jobId: jobsRow.id };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async markJobFailed(jobId: string, errorMessage: string): Promise<void> {
    const supabase = this.supabaseService.getServiceRoleClient();
    await supabase
      .from('jobs')
      .update({
        status: 'failed',
        progress: 0,
        result: { error: errorMessage },
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);
  }

  private async findExistingJob(
    userId: string,
    type: string,
    clientRequestId?: string,
  ): Promise<JobsRow | null> {
    if (!clientRequestId) return null;
    const supabase = this.supabaseService.getServiceRoleClient();
    // Only reuse non-terminal rows. A failed/completed row with the same
    // clientRequestId is a previous attempt; we create a new job so the
    // user can retry.
    const { data } = await supabase
      .from('jobs')
      .select('*')
      .eq('user_id', userId)
      .eq('type', type)
      .eq('client_request_id', clientRequestId)
      .not('status', 'in', '(failed,completed)')
      .maybeSingle();
    return (data as JobsRow | null) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

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

    if (jobsRow.status === 'queued' || jobsRow.status === 'active') {
      // For clip_analysis rows the stored bullmq_id points to the
      // *transcription* job (analysis is a two-stage pipeline). For all
      // other types, bullmq_id is the actual queue job.
      const queuesToCheck =
        jobsRow.type === 'clip_analysis'
          ? [this.transcriptionQueue, this.clipAnalysisQueue, this.renderQueue]
          : [this.transcriptionQueue, this.clipAnalysisQueue, this.renderQueue];
      for (const queue of queuesToCheck) {
        if (!jobsRow.bullmq_id) continue;
        const bullJob = await queue.getJob(jobsRow.bullmq_id);
        if (bullJob) {
          const bullState = await bullJob.getState();
          const bullProgress = bullJob.progress || 0;
          let bullStatus = jobsRow.status;
          if (bullState === 'completed') bullStatus = 'completed';
          else if (bullState === 'failed') bullStatus = 'failed';
          else if (bullState === 'active') bullStatus = 'active';

          // If BullMQ says the job failed but the DB still says
          // queued/active, reconcile by writing the terminal state.
          if (
            bullStatus !== jobsRow.status &&
            (bullStatus === 'failed' || bullStatus === 'completed')
          ) {
            await supabase
              .from('jobs')
              .update({
                status: bullStatus,
                progress: typeof bullProgress === 'number' ? bullProgress : 0,
                result: bullJob.returnvalue ?? jobsRow.result ?? null,
                updated_at: new Date().toISOString(),
              })
              .eq('id', jobsRow.id);
          }

          return {
            jobId: jobsRow.id,
            type: jobsRow.type,
            status: bullStatus.toUpperCase(),
            progress: typeof bullProgress === 'number' ? bullProgress : 0,
            returnvalue: bullJob.returnvalue ?? jobsRow.result ?? undefined,
            failedReason: bullJob.failedReason ?? undefined,
            clientRequestId: jobsRow.client_request_id ?? undefined,
            projectId: jobsRow.project_id,
            updatedAt: jobsRow.updated_at,
          };
        }
      }
    }

    const result = typeof jobsRow.result === 'string' ? JSON.parse(jobsRow.result) : jobsRow.result;
    return {
      jobId: jobsRow.id,
      type: jobsRow.type,
      status: jobsRow.status.toUpperCase(),
      progress: jobsRow.progress,
      returnvalue: result ?? undefined,
      failedReason: this.extractFailedReason(result),
      clientRequestId: jobsRow.client_request_id ?? undefined,
      projectId: jobsRow.project_id,
      updatedAt: jobsRow.updated_at,
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

  async listActiveJobsForUser(userId: string): Promise<ActiveJobDto[]> {
    const supabase = this.supabaseService.getServiceRoleClient();
    const { data, error } = await supabase
      .from('jobs')
      .select('id, project_id, type, status, progress, result, updated_at, client_request_id')
      .eq('user_id', userId)
      .in('status', ['queued', 'active'])
      .order('updated_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(`Failed to list active jobs: ${error.message}`);

    return (data ?? []).map((row: any) => {
      const result = typeof row.result === 'string' ? JSON.parse(row.result) : row.result;
      return {
        jobId: row.id,
        projectId: row.project_id,
        type: row.type,
        status: (row.status as string).toUpperCase() as ActiveJobDto['status'],
        progress: row.progress ?? 0,
        result: result ?? undefined,
        failedReason: this.extractFailedReason(result),
        updatedAt: row.updated_at,
        clientRequestId: row.client_request_id ?? undefined,
      };
    });
  }

  async getLatestJobForProject(
    projectId: string,
    userId: string,
    type?: 'transcription' | 'clip_analysis' | 'render' | 'edit_prompt',
  ): Promise<JobStatusDto | null> {
    const supabase = this.supabaseService.getServiceRoleClient();
    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', userId)
      .single();
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    let query = supabase
      .from('jobs')
      .select('id')
      .eq('project_id', projectId)
      .order('updated_at', { ascending: false })
      .limit(1);
    if (type) query = query.eq('type', type);
    const { data: row } = await query.maybeSingle();
    if (!row) return null;
    return this.getJob(row.id);
  }

  // ---------------------------------------------------------------------------
  // Legacy / cache helpers
  // ---------------------------------------------------------------------------

  getJobProgress(jobId: string): JobStatusDto {
    const cached = this.progressCache.get(jobId);
    if (cached) return cached;
    return { jobId, status: 'QUEUED', progress: 0 };
  }

  async updateJobProgress(jobId: string, status: JobStatusDto): Promise<void> {
    this.progressCache.set(jobId, status);
    const supabase = this.supabaseService.getServiceRoleClient();
    const updates: Partial<{
      status: string;
      progress: number;
      result: any;
      updated_at: string;
    }> = { progress: status.progress };
    if (status.returnvalue !== undefined) updates.result = status.returnvalue;
    if (status.status) updates.status = status.status.toLowerCase();

    const { error } = await supabase
      .from('jobs')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', jobId);
    if (error) {
      console.error(`Failed to update job ${jobId} in DB: ${error.message}`);
    }
  }

  private extractFailedReason(result: any): string | undefined {
    if (!result) return undefined;
    if (typeof result === 'string') {
      try {
        return this.extractFailedReason(JSON.parse(result));
      } catch {
        return undefined;
      }
    }
    if (typeof result !== 'object') return undefined;
    const err = (result as Record<string, unknown>).error;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object' && 'message' in (err as Record<string, unknown>)) {
      const m = (err as Record<string, unknown>).message;
      if (typeof m === 'string') return m;
    }
    return undefined;
  }
}
