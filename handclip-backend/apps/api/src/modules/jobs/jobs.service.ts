import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JobStatusDto } from '@handclip/shared';

interface AnalysisJob {
  projectId: string;
  videoUrl: string;
}

@Injectable()
export class JobsService {
  // In-memory progress cache for sync access
  private progressCache = new Map<string, JobStatusDto>();

  constructor(
    @InjectQueue('transcription') private transcriptionQueue: Queue,
    @InjectQueue('clip-analysis') private clipAnalysisQueue: Queue,
    @InjectQueue('render') private renderQueue: Queue,
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
  }) {
    const job = await this.renderQueue.add('render-video', data, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
    });
    return { jobId: job.id };
  }

  async enqueueAnalysis(projectId: string, videoUrl: string) {
    const transcriptionJob = await this.transcriptionQueue.add(
      'transcribe',
      { projectId, videoUrl } as AnalysisJob,
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      },
    );

    return {
      jobId: transcriptionJob.id,
      message: 'Transcription job queued. Clip analysis will start automatically.',
    };
  }

  async getJob(jobId: string): Promise<JobStatusDto> {
    // Search all 3 queues
    const queues = [this.transcriptionQueue, this.clipAnalysisQueue, this.renderQueue];

    for (const queue of queues) {
      const job = await queue.getJob(jobId);
      if (job) {
        return this.mapJobToStatus(job);
      }
    }

    // Fallback to cache
    const cached = this.progressCache.get(jobId);
    if (cached) return cached;

    throw new Error(`Job ${jobId} not found`);
  }

  getJobProgress(jobId: string): JobStatusDto {
    const cached = this.progressCache.get(jobId);
    if (cached) return cached;
    return {
      jobId,
      status: 'QUEUED',
      progress: 0,
    };
  }

  async updateJobProgress(jobId: string, status: JobStatusDto): Promise<void> {
    this.progressCache.set(jobId, status);
  }

  private async mapJobToStatus(job: any): Promise<JobStatusDto> {
    const state = await job.getState();
    const progress = job.progress || 0;
    let status: string = 'QUEUED';
    if (state === 'completed') status = 'COMPLETED';
    else if (state === 'failed') status = 'FAILED';
    else if (state === 'active') status = 'PROCESSING';
    else if (state === 'waiting') status = 'QUEUED';
    else if (state === 'delayed') status = 'QUEUED';

    return {
      jobId: job.id as string,
      status,
      progress: typeof progress === 'number' ? progress : 0,
      returnvalue: job.returnvalue,
      failedReason: job.failedReason,
    };
  }
}
