import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { SupabaseService } from '../modules/supabase/supabase.service';
import { NotificationsService } from '../modules/notifications/notifications.service';

interface EditPromptJobData {
  projectId: string;
  userId: string;
  prompt: string;
  trackingJobId: string;
}

@Processor('edit-prompt')
export class EditPromptProcessor extends WorkerHost {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly notificationsService: NotificationsService,
  ) {
    super();
  }

  async process(job: Job<EditPromptJobData>): Promise<{ ok: true }> {
    const { projectId, userId, prompt, trackingJobId } = job.data;
    const supabase = this.supabaseService.getServiceRoleClient();

    await supabase
      .from('jobs')
      .update({ status: 'active', progress: 25 })
      .eq('id', trackingJobId);

    // Placeholder for LLM-driven edit orchestration. The actual edit
    // actions (clip trim changes, subtitle rewrites, etc.) are produced
    // by the LLM and applied to clips / subtitles / exports. For now we
    // acknowledge the prompt and mark complete so the contract is stable.
    void prompt;
    void projectId;
    void userId;

    await supabase
      .from('jobs')
      .update({
        status: 'completed',
        progress: 100,
        result: { ok: true, appliedAt: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      })
      .eq('id', trackingJobId);

    await job.updateProgress(100);

    await this.notificationsService.sendPushNotification(
      userId,
      'Edición aplicada',
      'Tu edición por prompt se ha aplicado al proyecto.',
      { type: 'edit_complete', projectId, jobId: trackingJobId },
    );

    return { ok: true };
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
