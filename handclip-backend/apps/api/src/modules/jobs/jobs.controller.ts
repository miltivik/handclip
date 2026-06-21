import { Controller, Get, Param, Sse, Req, HttpException, HttpStatus } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { CurrentUser } from '../../decorators/current-user.decorator';
import { CurrentToken } from '../../decorators/current-token.decorator';
import { Observable } from 'rxjs';
import { QueueEvents } from 'bullmq';
import { JobsService } from './jobs.service';

// Max concurrent SSE connections per IP. The throttle on the endpoint
// caps burst establishment; this caps ongoing cost. Each connection
// runs a 5s DB poll until completion, so a single attacker holding 3
// connections generates at most 36 polls/min. 0 = unlimited (not exposed).
const MAX_SSE_PER_IP = 3;
// DB poll cadence. 5s instead of 2s halves the per-connection load.
// BullMQ QueueEvents (push) handles the real-time path; this is the
// recovery fallback for missed events.
const POLL_INTERVAL_MS = 5_000;

// ponytail: in-process Map. Same caveat as the provider rate limit
// and upload state — single-replica OK, multi-replica needs Redis.
const sseConnectionsByIp = new Map<string, number>();

// Defensive: cleanup() deletes the entry on req.close, but if the
// handler is short-circuited (e.g. subscriber.error before cleanup
// is registered) or the close event is missed, the entry can
// leak. Periodic sweep keeps the Map bounded. unref() so this
// interval never blocks process exit.
const sseConnectionsSweep = setInterval(() => {
  for (const [ip, count] of sseConnectionsByIp) {
    if (count <= 0) sseConnectionsByIp.delete(ip);
  }
}, 5 * 60_000);
sseConnectionsSweep.unref();
@Controller()
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get('jobs/:jobId')
  async getJobStatus(
    @Param('jobId') jobId: string,
    @CurrentUser() user: { id: string },
    @CurrentToken() token: string,
  ) {
    return this.jobsService.getJob(jobId, user.id, token);
  }

  // SSE endpoint. JWT required. Browser EventSource can't send custom
  // headers, so a `?token=...` query param would be needed for browser use;
  // deferred. The mobile app polls getJobStatus instead.
  // - Throttle caps burst connection establishment (5/30s per IP).
  // - Per-IP concurrent cap (3) prevents slow-burn DoS via long-held connections.
  // - The 5s poll is the recovery fallback for missed BullMQ events.
  // - Ownership: getJob throws if the job's project doesn't belong to the
  //   caller. Verified at connect time (close early) and at every tick
  //   (silent ignore if the ownership changes mid-stream).
  @Throttle({ default: { limit: 5, ttl: seconds(30) } })
  @Sse('jobs/:jobId/progress')
  getJobProgress(
    @Param('jobId') jobId: string,
    @CurrentUser() user: { id: string },
    @CurrentToken() token: string,
    @Req() req: any,
  ): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      let cleaned = false;
      const ip = req.ip || 'unknown';

      // defense-in-depth: verify ownership at connection time, close early if not owner
      this.jobsService.getJob(jobId, user.id, token).catch(() => {
        if (cleaned) return;
        subscriber.error(new HttpException('Job not found', HttpStatus.NOT_FOUND));
      });

      if (MAX_SSE_PER_IP > 0) {
        const current = sseConnectionsByIp.get(ip) || 0;
        if (current >= MAX_SSE_PER_IP) {
          subscriber.error(
            new HttpException(
              `Too many concurrent SSE connections (max ${MAX_SSE_PER_IP} per IP)`,
              HttpStatus.TOO_MANY_REQUESTS,
            ),
          );
          return;
        }
        sseConnectionsByIp.set(ip, current + 1);
      }

      const redisConfig = {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      };

      const queueNames = ['transcription', 'clip-analysis', 'render'];
      const queueEventsList = queueNames.map(
        (name) => new QueueEvents(name, { connection: redisConfig }),
      );

      const handler = async (args: { jobId?: string; data?: unknown }) => {
        if (args.jobId && args.jobId !== jobId) return;

        try {
          const progress = await this.jobsService.getJob(jobId, user.id, token);
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

      // Recovery poll: only fires if no BullMQ event has arrived.
      const fallback = setInterval(async () => {
        try {
          const progress = await this.jobsService.getJob(jobId, user.id, token);
          subscriber.next({ data: JSON.stringify(progress) } as MessageEvent);

          if (progress.status === 'COMPLETED' || progress.status === 'FAILED') {
            clearInterval(fallback);
            subscriber.complete();
          }
        } catch {
          // not ready yet
        }
      }, POLL_INTERVAL_MS);

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
        if (MAX_SSE_PER_IP > 0) {
          const current = sseConnectionsByIp.get(ip) || 1;
          if (current <= 1) {
            sseConnectionsByIp.delete(ip);
          } else {
            sseConnectionsByIp.set(ip, current - 1);
          }
        }
      };

      req.on('close', cleanup);
      return cleanup;
    });
  }
}
