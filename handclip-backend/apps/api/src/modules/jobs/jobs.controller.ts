import { Controller, Get, Post, Param, Body, Sse } from '@nestjs/common';
import { Observable, interval, map } from 'rxjs';
import { JobsService } from './jobs.service';

@Controller()
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post('projects/:projectId/analyze')
  async analyze(
    @Param('projectId') projectId: string,
    @Body() body: { videoUrl: string },
  ) {
    const result = await this.jobsService.enqueueAnalysis(projectId, body.videoUrl);
    return { jobId: result.jobId };
  }

  @Get('jobs/:jobId')
  async getJobStatus(@Param('jobId') jobId: string) {
    return this.jobsService.getJob(jobId);
  }

  @Sse('jobs/:jobId/progress')
  getJobProgress(@Param('jobId') jobId: string): Observable<MessageEvent> {
    return interval(1000).pipe(
      map(() => {
        // Uses in-memory cache for sync access
        const progress = this.jobsService.getJobProgress(jobId);
        return {
          data: JSON.stringify(progress),
        } as MessageEvent;
      }),
    );
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