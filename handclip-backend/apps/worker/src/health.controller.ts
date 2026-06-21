import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SupabaseService } from './modules/supabase/supabase.service';

@Controller('health')
export class HealthController {
  constructor(
    @InjectQueue('transcription') private readonly transcriptionQueue: Queue,
    private readonly supabaseService: SupabaseService,
  ) {}

  @Get()
  async check() {
    const checks: Record<string, string> = { worker: 'ok' };

    // ponytail: ping is enough; full dep matrix belongs to /health/ready
    try {
      await this.transcriptionQueue.getJobCounts();
      checks.redis = 'ok';
    } catch (e: any) {
      checks.redis = `error: ${e.message}`;
    }

    try {
      const supabase = this.supabaseService.getServiceRoleClient();
      const { error } = await supabase.from('jobs').select('id', { count: 'exact', head: true });
      checks.supabase = error ? `error: ${error.message}` : 'ok';
    } catch (e: any) {
      checks.supabase = `error: ${e.message}`;
    }

    const healthy = Object.values(checks).every((v) => v === 'ok');
    const body = {
      status: healthy ? 'healthy' : 'degraded',
      service: 'handclip-worker',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks,
    };
    if (!healthy) {
      throw new ServiceUnavailableException(body);
    }
    return body;
  }
}
