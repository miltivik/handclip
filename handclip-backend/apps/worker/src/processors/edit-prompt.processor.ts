import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { SubtitleSegment } from '@handclip/shared';
import { SupabaseService } from '../modules/supabase/supabase.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { DatabaseAiConnectionStore } from '../providers/database-ai-connection.store';
import { ProviderManager, StageTask } from '../providers/provider-manager';
import {
  ClipForEditPrompt,
  EDIT_PROMPT_STRICT_PROMPT,
  EDIT_PROMPT_SYSTEM_PROMPT,
  applyEditActions,
  buildEditPromptUserPrompt,
  getEditPromptSkillsPrefix,
  parseEditPromptResult,
} from './edit-prompt-actions';

interface EditPromptJobData {
  projectId: string;
  userId: string;
  prompt: string;
  trackingJobId: string;
}

interface SubtitleRow {
  id: string;
  segments: SubtitleSegment[] | null;
}

interface ClipRow {
  id: string;
  start_time: number;
  end_time: number;
  confidence_score: number;
  suggested_caption: string | null;
  transcript_snippet: string | null;
  status: string;
}

interface ProjectRow {
  source_duration: number | null;
}

function toClipForEditPrompt(row: ClipRow): ClipForEditPrompt {
  return {
    id: row.id,
    startTime: Number(row.start_time) || 0,
    endTime: Number(row.end_time) || 0,
    confidenceScore: Number(row.confidence_score) || 0,
    suggestedCaption: row.suggested_caption ?? '',
    transcriptSnippet: row.transcript_snippet ?? '',
    status: row.status ?? 'candidate',
  };
}

@Processor('edit-prompt')
export class EditPromptProcessor extends WorkerHost {
  private readonly providerManager: ProviderManager;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly notificationsService: NotificationsService,
    config: ConfigService,
  ) {
    super();
    const encryptionKey = config.getOrThrow<string>('AI_CONNECTIONS_ENCRYPTION_KEY');
    const databaseStore = new DatabaseAiConnectionStore(
      supabaseService.getServiceRoleClient(),
      encryptionKey,
    );
    this.providerManager = new ProviderManager({ databaseConnectionStore: databaseStore });
  }

  async process(job: Job<EditPromptJobData>): Promise<{ appliedCount: number }> {
    const { projectId, userId, prompt, trackingJobId } = job.data;
    const supabase = this.supabaseService.getServiceRoleClient();
    const dbProgress = (progress: number) =>
      trackingJobId ? 10 + Math.round(progress * 0.9) : progress;

    await supabase
      .from('jobs')
      .update({ status: 'active', progress: dbProgress(0), bullmq_id: job.id })
      .eq('id', trackingJobId);
    await job.updateProgress(10);
    console.log(`[EditPrompt] Applying edit for project ${projectId}: "${prompt.slice(0, 80)}"`);

    // Load project state: transcript, clips and source duration.
    const [{ data: subtitleRows }, { data: clipRows }, { data: projectRow }] = await Promise.all([
      supabase
        .from('subtitles')
        .select('id, segments')
        .eq('project_id', projectId)
        .is('clip_id', null)
        .order('created_at', { ascending: false })
        .limit(1),
      supabase
        .from('clips')
        .select('id, start_time, end_time, confidence_score, suggested_caption, transcript_snippet, status')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true }),
      supabase.from('projects').select('source_duration').eq('id', projectId).single(),
    ]);

    const subtitleRow = (subtitleRows?.[0] as SubtitleRow | undefined) ?? undefined;
    const segments: SubtitleSegment[] = Array.isArray(subtitleRow?.segments)
      ? subtitleRow.segments
      : [];
    const clips: ClipForEditPrompt[] = ((clipRows as ClipRow[] | null) ?? []).map(
      toClipForEditPrompt,
    );
    const videoDuration = (projectRow as ProjectRow | null)?.source_duration ?? null;

    await supabase.from('jobs').update({ progress: dbProgress(20) }).eq('id', trackingJobId);
    await job.updateProgress(20);

    const task: StageTask = {
      stage: 'edit-prompt',
      systemPrompt: `${getEditPromptSkillsPrefix()}${EDIT_PROMPT_SYSTEM_PROMPT}`,
      userPrompt: buildEditPromptUserPrompt({ prompt, segments, clips }),
      maxTokens: 3000,
      temperature: 0.2,
    };

    const MAX_RETRIES = 1;
    let lastError: Error | null = null;
    let result = null as ReturnType<typeof parseEditPromptResult> | null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const llmResult = await this.providerManager.callWithUserProvider(task, userId);
        console.log(
          `[EditPrompt] Received response from ${llmResult.provider} (${llmResult.model})`,
        );
        result = parseEditPromptResult(llmResult.content);
        break;
      } catch (err: any) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          console.warn(`[EditPrompt] Attempt ${attempt + 1} failed, retrying with stricter prompt...`);
          task.userPrompt = `${buildEditPromptUserPrompt({ prompt, segments, clips })}\n\n${EDIT_PROMPT_STRICT_PROMPT}`;
        }
      }
    }

    if (!result) {
      throw lastError || new Error('Edit prompt failed after all retries');
    }

    await supabase.from('jobs').update({ progress: dbProgress(60) }).eq('id', trackingJobId);
    await job.updateProgress(60);

    const { applied, skippedCount } = await applyEditActions(supabase, {
      actions: result.actions,
      clips,
      segments,
      subtitleRowId: subtitleRow?.id ?? null,
      videoDuration: Number.isFinite(Number(videoDuration)) ? Number(videoDuration) : null,
    });
    const appliedCount = applied.filter((entry) => entry.applied).length;

    await supabase
      .from('jobs')
      .update({
        status: 'completed',
        progress: 100,
        result: {
          summary: result.summary,
          applied_count: appliedCount,
          skipped_count: skippedCount,
          actions: applied,
          appliedAt: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', trackingJobId);
    await job.updateProgress(100);
    console.log(
      `[EditPrompt] Completed for project ${projectId}: ${appliedCount} applied, ${skippedCount} skipped`,
    );

    await this.notificationsService.sendPushNotification(
      userId,
      'Edición aplicada',
      appliedCount > 0
        ? `${result.summary || `Se aplicaron ${appliedCount} cambios.`}`
        : 'No hubo cambios que aplicar. Revisa el detalle del trabajo.',
      { type: 'edit_complete', projectId, jobId: trackingJobId },
    );

    return { appliedCount };
  }

  async onFailed(job: Job<EditPromptJobData> | undefined, err: Error): Promise<void> {
    if (!job) return;
    const { userId, projectId, trackingJobId } = job.data;
    const supabase = this.supabaseService.getServiceRoleClient();
    await supabase
      .from('jobs')
      .update({
        status: 'failed',
        progress: 0,
        result: { error: err.message },
        updated_at: new Date().toISOString(),
      })
      .eq('id', trackingJobId);

    await this.notificationsService.sendPushNotification(
      userId,
      'La edición falló',
      'No se pudo aplicar la edición. Inténtalo de nuevo.',
      { type: 'job_failed', projectId, jobId: trackingJobId },
    );
  }
}
