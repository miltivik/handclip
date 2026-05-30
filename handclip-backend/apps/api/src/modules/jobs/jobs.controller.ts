import { Controller, Get, Post, Param, Body, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { QueueEvents } from 'bullmq';
import { JobsService } from './jobs.service';

@Controller()
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  // analyze endpoint is in ProjectsController to avoid route conflict

  @Get('jobs/:jobId')
  async getJobStatus(@Param('jobId') jobId: string) {
    return this.jobsService.getJob(jobId);
  }

  @Sse('jobs/:jobId/progress')
  getJobProgress(@Param('jobId') jobId: string): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      const redisConfig = {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      };

      // Listen on all three queue event streams
      const queueNames = ['transcription', 'clip-analysis', 'render'];
      const queueEventsList = queueNames.map(
        (name) => new QueueEvents(name, { connection: redisConfig }),
      );

      const handler = async (args: { jobId?: string; data?: any }) => {
        if (args.jobId && args.jobId !== jobId) return;

        try {
          const progress = await this.jobsService.getJob(jobId);
          subscriber.next({ data: JSON.stringify(progress) } as MessageEvent);

          if (progress.status === 'COMPLETED' || progress.status === 'FAILED') {
            subscriber.complete();
          }
        } catch {
          // Job not yet in DB — ignore
        }
      };

      for (const qe of queueEventsList) {
        qe.on('progress', handler);
        qe.on('completed', handler);
        qe.on('failed', handler);
      }

      // Fallback: emit current state every 2s while waiting for BullMQ events
      const fallback = setInterval(async () => {
        try {
          const progress = await this.jobsService.getJob(jobId);
          subscriber.next({ data: JSON.stringify(progress) } as MessageEvent);

          if (progress.status === 'COMPLETED' || progress.status === 'FAILED') {
            clearInterval(fallback);
            subscriber.complete();
          }
        } catch {
          // not ready yet
        }
      }, 2000);

      return () => {
        clearInterval(fallback);
        for (const qe of queueEventsList) {
          qe.off('progress', handler);
          qe.off('completed', handler);
          qe.off('failed', handler);
          qe.close();
        }
      };
    });
  }

  @Post('jobs/:jobId/progress')
  async updateProgress(
    @Param('jobId') jobId: string,
    @Body() body: { jobId: string; type: string; status: string; progress: number },
  ) {
    await this.jobsService.updateJobProgress(body.jobId, body as any);
    return { success: true };
  }
}
