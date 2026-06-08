import { Controller, Get, Param, Sse, UseGuards } from '@nestjs/common';
import { Observable } from 'rxjs';
import { QueueEvents } from 'bullmq';
import { JobsService } from './jobs.service';
import { BearerUserGuard } from '../auth/bearer-user.guard';
import { CurrentUser, ResolvedUser } from '../auth/current-user.decorator';

@Controller()
@UseGuards(BearerUserGuard)
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get('jobs/active')
  async listActiveJobs(@CurrentUser() user: ResolvedUser) {
    return this.jobsService.listActiveJobsForUser(user.id);
  }

  @Get('projects/:projectId/jobs/latest')
  async getLatestJobForProject(
    @CurrentUser() user: ResolvedUser,
    @Param('projectId') projectId: string,
  ) {
    const job = await this.jobsService.getLatestJobForProject(projectId, user.id);
    if (!job) return null;
    return job;
  }

  @Get('jobs/:jobId')
  async getJobStatus(
    @CurrentUser() user: ResolvedUser,
    @Param('jobId') jobId: string,
  ) {
    return this.jobsService.getJobForUser(jobId, user.id);
  }

  @Sse('jobs/:jobId/progress')
  getJobProgress(
    @CurrentUser() user: ResolvedUser,
    @Param('jobId') jobId: string,
  ): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      const redisConfig = {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      };

      const queueNames = ['transcription', 'clip-analysis', 'render', 'edit-prompt'];
      const queueEventsList = queueNames.map(
        (name) => new QueueEvents(name, { connection: redisConfig }),
      );

      const handler = async (args: { jobId?: string; data?: any }) => {
        if (args.jobId && args.jobId !== jobId) return;
        try {
          const progress = await this.jobsService.getJobForUser(jobId, user.id);
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

      const fallback = setInterval(async () => {
        try {
          const progress = await this.jobsService.getJobForUser(jobId, user.id);
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
}
