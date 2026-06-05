import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../modules/supabase/supabase.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPORT_RETENTION_DAYS = 30;
const SOURCE_VIDEO_RETENTION_DAYS = 7;
const CLEANUP_JOB_NAME = 'storage-lifecycle-cleanup';
const CLEANUP_REPEAT_JOB_ID = 'storage-lifecycle-cleanup-daily';

interface CleanupResult {
  exportsDeleted: number;
  sourceVideosCleaned: number;
  errors: string[];
}

interface ExportRow {
  id: string;
  project_id: string;
  preset: string;
  completed_at: string;
}

interface ProjectRow {
  id: string;
  source_video_url: string | null;
}

@Processor('cleanup')
export class CleanupProcessor extends WorkerHost {
  constructor(
    private readonly supabaseService: SupabaseService,
    @InjectQueue('cleanup') private readonly cleanupQueue: Queue,
  ) {
    super();
  }

  async onModuleInit() {
    await this.cleanupQueue.add(CLEANUP_JOB_NAME, {}, {
      jobId: CLEANUP_REPEAT_JOB_ID,
      repeat: { pattern: '0 3 * * *', tz: 'UTC' },
      removeOnComplete: { count: 7 },
      removeOnFail: { count: 30 },
    });
  }

  async process(_job: Job): Promise<CleanupResult> {
    const supabase = this.supabaseService.getServiceRoleClient();
    const now = new Date();
    const errors: string[] = [];

    const exportsDeleted = await this.cleanupOldExports(supabase, now, errors);
    const sourceVideosCleaned = await this.cleanupOldSourceVideos(supabase, now, errors);

    console.log(`[Cleanup] exports=${exportsDeleted}, sourceVideos=${sourceVideosCleaned}, errors=${errors.length}`);
    return { exportsDeleted, sourceVideosCleaned, errors };
  }

  async cleanupOldExports(supabase: SupabaseClient, now: Date, errors: string[]): Promise<number> {
    const cutoff = new Date(now.getTime() - EXPORT_RETENTION_DAYS * DAY_MS).toISOString();

    const { data: staleExports, error } = await supabase
      .from('exports')
      .select('id, project_id, preset, completed_at')
      .eq('status', 'completed')
      .not('completed_at', 'is', null)
      .lt('completed_at', cutoff);

    if (error) {
      errors.push(`exports query: ${error.message}`);
      return 0;
    }

    if (!staleExports?.length) return 0;

    let deleted = 0;
    for (const row of staleExports as ExportRow[]) {
      try {
        // Check for newer sibling export (same project + preset)
        const { data: siblings } = await supabase
          .from('exports')
          .select('id')
          .eq('project_id', row.project_id)
          .eq('preset', row.preset)
          .neq('id', row.id)
          .eq('status', 'completed')
          .not('completed_at', 'is', null)
          .gte('completed_at', cutoff)
          .limit(1);

        // Only delete storage if no live sibling shares the same path
        if (!siblings?.length) {
          const exportPath = `${row.project_id}/${row.preset}/output.mp4`;
          const thumbPath = `${row.project_id}/${row.preset}/thumbnail.jpg`;
          await supabase.storage.from('exports').remove([exportPath]);
          await supabase.storage.from('thumbnails').remove([thumbPath]);
        }

        await supabase.from('exports').delete().eq('id', row.id);
        deleted++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`export ${row.id}: ${msg}`);
      }
    }
    return deleted;
  }

  async cleanupOldSourceVideos(supabase: SupabaseClient, now: Date, errors: string[]): Promise<number> {
    const cutoff = new Date(now.getTime() - SOURCE_VIDEO_RETENTION_DAYS * DAY_MS).toISOString();

    const { data: staleProjects, error } = await supabase
      .from('projects')
      .select('id, source_video_url')
      .lt('created_at', cutoff)
      .not('source_video_url', 'is', null);

    if (error) {
      errors.push(`projects query: ${error.message}`);
      return 0;
    }

    if (!staleProjects?.length) return 0;

    let cleaned = 0;
    for (const project of staleProjects as ProjectRow[]) {
      try {
        const storagePath = project.source_video_url;
        if (storagePath) {
          await supabase.storage.from('source-videos').remove([storagePath]);
        }
        await supabase
          .from('projects')
          .update({ source_video_url: null, updated_at: new Date().toISOString() })
          .eq('id', project.id);
        cleaned++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`project ${project.id}: ${msg}`);
      }
    }
    return cleaned;
  }
}