import { Controller, Get, Param, Sse, Req } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { Public } from '../../decorators/public.decorator';
import { CurrentToken } from '../../decorators/current-token.decorator';
import { Observable } from 'rxjs';
import { QueueEvents } from 'bullmq';
import { JobsService } from './jobs.service';

@Controller()
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  // analyze endpoint is in ProjectsController to avoid route conflict

  @Get('jobs/:jobId')
  async getJobStatus(
    @Param('jobId') jobId: string,
    @CurrentToken() token: string,
  ) {
    return this.jobsService.getJob(jobId, token);
  }

  // SSE endpoint: EventSource doesn't reliably send auth headers; job IDs are UUIDs (unguessable).
  // Throttle caps burst connection establishment (5/30s per IP). The connection
  // itself runs a 2s DB poll until completion — DoS-by-slow-burn is a
  // separate concern (would need a per-IP concurrent-connection counter).
  @Public()
  @Throttle({ default: { limit: 5, ttl: seconds(30) } })
  @Sse('jobs/:jobId/progress')
  getJobProgress(@Param('jobId') jobId: string, @Req() req: any): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      let cleaned = false;
      const redisConfig = {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      };

      // Listen on all three queue event streams
      const queueNames = ['transcription', 'clip-analysis', 'render'];
      const queueEventsList = queueNames.map(
        (name) => new QueueEvents(name, { connection: redisConfig }),
      );

      const handler = async (args: { jobId?: string; data?: unknown }) => {
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

      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        clearInterval(fallback);
        for (const qe of queueEventsList) {
          qe.off('progress', handler);
          qe.off('completed', handler);
          qe.off('failed', handler);
          qe.close().catch(() => {});
        }
      };

      req.on('close', cleanup);
      return cleanup;
    });
  }
}
