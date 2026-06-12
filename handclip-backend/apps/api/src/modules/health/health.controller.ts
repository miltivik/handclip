import { Controller, Get } from '@nestjs/common';
import { Public } from '../../decorators/public.decorator';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SupabaseService } from '../supabase/supabase.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly supabaseService: SupabaseService,
    @InjectQueue('transcription') private readonly transcriptionQueue: Queue,
  ) {}

  @Public()
  @Get()
  async check() {
    const checks: Record<string, string> = { api: 'ok' };

    // Check Redis via BullMQ queue operation
    try {
      await this.transcriptionQueue.getJobCounts();
      checks.redis = 'ok';
    } catch (e: any) {
      checks.redis = `error: ${e.message}`;
    }

    // Check Supabase
    try {
      const supabase = this.supabaseService.getClient();
      const { error } = await supabase.from('profiles').select('count', { count: 'exact', head: true });
      checks.supabase = error ? `error: ${error.message}` : 'ok';
    } catch (e: any) {
      checks.supabase = `error: ${e.message}`;
    }

    return {
      status: Object.values(checks).every((v) => v === 'ok') ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    };
  }
}
