import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ClipCandidate, ClipCandidateSchema, SubtitleSegment, getSkillsForStage } from '@handclip/shared';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../modules/supabase/supabase.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { DatabaseAiConnectionStore } from '../providers/database-ai-connection.store';
import { ProviderManager, StageTask } from '../providers/provider-manager';
const CLIP_ANALYSIS_SYSTEM_PROMPT = `Eres un analista de contenido para redes sociales. Tu tarea es identificar los mejores momentos de una transcripción de video para crear clips cortos virales (TikTok, Reels, Shorts).

Analiza la transcripción y devuelve un JSON con este formato exacto:
{
  "clips": [
    {
      "id": "clip_001",
      "startTime": 12.5,
      "endTime": 45.2,
      "confidenceScore": 78,
      "reasons": ["high_energy", "key_statement"],
      "suggestedCaption": "Cuando dices la verdad...",
      "transcriptSnippet": "...la gente piensa que esto es suerte...",
      "moodTags": ["inspirational"],
      "platformTargets": ["tiktok", "instagram_reels"]
    }
  ]
}

Reglas:
- confidenceScore: 0-100 basado en potencial viral (no garantices viralidad)
- reasons: solo usar estos valores: high_energy, emotional_peak, key_statement, punchline, reveal_moment, question_engagement, call_to_action, contrast_shift, informative, visual_interest
- moodTags: solo usar: inspirational, funny, controversial, educational, emotional, mysterious, uplifting
- Máximo 5 clips. Cada clip entre 15-90 segundos.
- Los timestamps deben coincidir EXACTAMENTE con los proporcionados.
- duration es opcional, pero si la calculas debe ser endTime - startTime`;

const CLIP_ANALYSIS_STRICT_PROMPT = `Tu respuesta anterior no fue un JSON válido. Devuelve SOLO un objeto JSON con la clave "clips" conteniendo un array de clips. Sin texto adicional, sin markdown, sin explicaciones.

Formato exacto requerido:
{"clips":[{"id":"clip_001","startTime":0,"endTime":0,"confidenceScore":0,"reasons":[],"suggestedCaption":"","transcriptSnippet":"","moodTags":[],"platformTargets":[]}]}

Corrige tu respuesta y responde con JSON válido.`;

// Valid reasons and moodTags
const VALID_REASONS = new Set([
  'high_energy',
  'emotional_peak',
  'key_statement',
  'punchline',
  'reveal_moment',
  'question_engagement',
  'call_to_action',
  'contrast_shift',
  'informative',
  'visual_interest',
]);

const VALID_MOOD_TAGS = new Set([
  'inspirational',
  'funny',
  'controversial',
  'educational',
  'emotional',
  'mysterious',
  'uplifting',
]);

interface ClipAnalysisJobData {
  projectId: string;
  userId: string;
  // Storage path (preferred). Clip-analysis currently only uses
  // transcriptionSegments; sourceVideoPath is kept here for parity with
  // the transcription/render jobs and to enable LLM video-aware features
  // in the future.
  sourceVideoPath?: string;
  videoUrl?: string;
  transcriptionSegments?: SubtitleSegment[];
  trackingJobId?: string;
}

function buildUserPrompt(segments: SubtitleSegment[]): string {
  if (!segments || segments.length === 0) {
    return 'No hay transcripción disponible para analizar.';
  }

  const formattedSegments = segments
    .map((seg) => `[${seg.startTime.toFixed(2)}s - ${seg.endTime.toFixed(2)}s] ${seg.text}`)
    .join('\n');

  return `Analiza la siguiente transcripción del video:

${formattedSegments}

Identifica los mejores momentos para crear clips virales.`;
}

function normalizeClip(clip: Record<string, unknown>): Partial<ClipCandidate> {
  const reasons = Array.isArray(clip.reasons)
    ? clip.reasons.map((r) => String(r).toLowerCase()).filter((r) => VALID_REASONS.has(r))
    : [];

  const moodTags = Array.isArray(clip.moodTags)
    ? clip.moodTags.map((t) => String(t).toLowerCase()).filter((t) => VALID_MOOD_TAGS.has(t))
    : [];

  const platformTargets = Array.isArray(clip.platformTargets)
    ? clip.platformTargets.map((p) => String(p).toLowerCase())
    : ['tiktok', 'youtube_shorts'];

  return {
    id: String(clip.id || `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
    startTime: Number(clip.startTime) || 0,
    endTime: Number(clip.endTime) || 0,
    confidenceScore: Math.min(100, Math.max(0, Number(clip.confidenceScore) || 50)),
    reasons,
    suggestedCaption: String(clip.suggestedCaption || clip.suggested_caption || ''),
    transcriptSnippet: String(clip.transcriptSnippet || clip.transcript_snippet || ''),
    moodTags,
    platformTargets,
  };
}

function parseAndValidateClips(content: string): ClipCandidate[] {
  const trimmed = content.trim();

  // Try to extract JSON from markdown code blocks
  let jsonStr = trimmed;
  if (trimmed.startsWith('```')) {
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) {
      jsonStr = match[1].trim();
    } else {
      // No code block found, try to extract first { ... }
      const firstBrace = trimmed.indexOf('{');
      const lastBrace = trimmed.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        jsonStr = trimmed.substring(firstBrace, lastBrace + 1);
      }
    }
  }

  const parsed = JSON.parse(jsonStr);
  const clipsData = Array.isArray(parsed.clips) ? parsed.clips : Array.isArray(parsed) ? parsed : [];

  return clipsData
    .map((clip: Record<string, unknown>) => {
      const normalized = normalizeClip(clip as Record<string, unknown>);
      try {
        return ClipCandidateSchema.parse(normalized);
      } catch {
        // Partial validation - return with defaults
        return ClipCandidateSchema.parse({
          id: normalized.id || `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          startTime: normalized.startTime ?? 0,
          endTime: normalized.endTime ?? 0,
          confidenceScore: normalized.confidenceScore ?? 50,
          reasons: normalized.reasons ?? [],
          suggestedCaption: normalized.suggestedCaption ?? '',
          transcriptSnippet: normalized.transcriptSnippet ?? '',
          moodTags: normalized.moodTags ?? [],
          platformTargets: normalized.platformTargets ?? ['tiktok'],
        });
      }
    })
    .filter((clip: ClipCandidate): clip is ClipCandidate => clip.startTime < clip.endTime);
}

@Processor('clip-analysis')
export class ClipAnalysisProcessor extends WorkerHost {
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

  async process(job: Job<ClipAnalysisJobData>): Promise<{ clips: ClipCandidate[] }> {
    const { projectId, userId, transcriptionSegments, trackingJobId } = job.data;
    const supabase = this.supabaseService.getServiceRoleClient();
    const dbProgress = (progress: number) =>
      trackingJobId ? 60 + Math.round(progress * 0.4) : progress;

    let dbJobId: string | undefined;
    if (trackingJobId) {
      const { data: jobRecord, error } = await supabase
        .from('jobs')
        .update({ status: 'active', progress: dbProgress(10), bullmq_id: job.id })
        .eq('id', trackingJobId)
        .select('id')
        .single();
      if (error) {
        console.error(`[ClipAnalysis] Failed to update job: ${error.message}`);
      }
      dbJobId = jobRecord?.id;
    } else {
      const { data: jobRecord, error } = await supabase
        .from('jobs')
        .insert({
          project_id: projectId,
          user_id: userId,
          type: 'clip_analysis',
          status: 'active',
          progress: 10,
          bullmq_id: job.id,
        })
        .select('id')
        .single();
      if (error) {
        console.error(`[ClipAnalysis] Failed to create job record: ${error.message}`);
      }
      dbJobId = jobRecord?.id;
    }

    await job.updateProgress(10);
    console.log(`[ClipAnalysis] Analyzing clips for project ${projectId}`);

    // Validate we have transcription data
    if (!transcriptionSegments || transcriptionSegments.length === 0) {
      if (dbJobId) {
        await supabase
          .from('jobs')
          .update({ status: 'completed', progress: 100, result: { clips_count: 0, clips: [] }, updated_at: new Date().toISOString() })
          .eq('id', dbJobId);
      }
      await supabase.from('projects').update({ status: 'ready' }).eq('id', projectId);
      await job.updateProgress(50);
      console.warn(`[ClipAnalysis] No transcription segments for project ${projectId}, returning empty`);
      await job.updateProgress(100);
      return { clips: [] };
    }

    if (dbJobId) {
      await supabase.from('jobs').update({ progress: dbProgress(30) }).eq('id', dbJobId);
    }
    await job.updateProgress(30);
    console.log(`[ClipAnalysis] Processing ${transcriptionSegments.length} transcription segments`);

    // Build the task for ProviderManager
    const skillRules = getSkillsForStage('clip-analysis');
    const task: StageTask = {
      stage: 'clip-analysis',
      systemPrompt: skillRules ? `${skillRules}\n\n${CLIP_ANALYSIS_SYSTEM_PROMPT}` : CLIP_ANALYSIS_SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(transcriptionSegments),
      maxTokens: 4000,
      temperature: 0.3,
    };

    if (dbJobId) {
      await supabase.from('jobs').update({ progress: dbProgress(40) }).eq('id', dbJobId);
    }
    await job.updateProgress(40);

    // Call LLM with fallback
    const MAX_RETRIES = 1;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await this.providerManager.callWithUserProvider(task, userId);

        if (dbJobId) {
          await supabase.from('jobs').update({ progress: dbProgress(60) }).eq('id', dbJobId);
        }
        await job.updateProgress(60);
        console.log(`[ClipAnalysis] Received response from ${result.provider} (${result.model})`);
        console.log(
          `[ClipAnalysis] Usage: ${result.usage.inputTokens} input tokens, ${result.usage.outputTokens} output tokens`,
        );

        const clips = parseAndValidateClips(result.content);

        if (dbJobId) {
          await supabase.from('jobs').update({ progress: dbProgress(80) }).eq('id', dbJobId);
        }
        await job.updateProgress(80);
        console.log(`[ClipAnalysis] Validated ${clips.length} clip candidates`);

        // Persist clips to DB
        if (clips.length > 0) {
          const clipRows = clips.map((clip) => ({
            project_id: projectId,
            start_time: clip.startTime,
            end_time: clip.endTime,
            duration: clip.endTime - clip.startTime,
            confidence_score: clip.confidenceScore,
            reasons: clip.reasons || [],
            suggested_caption: clip.suggestedCaption || '',
            transcript_snippet: clip.transcriptSnippet || '',
            mood_tags: clip.moodTags || [],
            platform_targets: clip.platformTargets || [],
            status: 'candidate',
          }));

          const { error: insertError } = await supabase.from('clips').insert(clipRows);
          if (insertError) {
            console.error(`[ClipAnalysis] Failed to persist clips: ${insertError.message}`);
          } else {
            console.log(`[ClipAnalysis] Persisted ${clips.length} clips to DB`);
          }
        }

        // Sort by confidence score descending
        clips.sort((a, b) => (b.confidenceScore || 0) - (a.confidenceScore || 0));

        // Mark project as ready
        await supabase.from('projects').update({ status: 'ready' }).eq('id', projectId);

        // Mark job as completed
        if (dbJobId) {
          await supabase
            .from('jobs')
            .update({
              status: 'completed',
              progress: 100,
              result: { clips_count: clips.length, clips },
              updated_at: new Date().toISOString(),
            })
            .eq('id', dbJobId);
        }
        await job.updateProgress(100);
        console.log(`[ClipAnalysis] Completed for project ${projectId}`);

        await this.notificationsService.sendPushNotification(
          userId,
          '¡Tu análisis está listo!',
          `Detectamos ${clips.length} clip${clips.length === 1 ? '' : 's'} candidato${clips.length === 1 ? '' : 's'} en tu video.`,
          { type: 'analysis_complete', projectId, jobId: dbJobId ?? '' },
        );

        return { clips };
      } catch (err: any) {
        lastError = err;

        if (attempt < MAX_RETRIES) {
          console.warn(`[ClipAnalysis] Attempt ${attempt + 1} failed, retrying with stricter prompt...`);
          task.userPrompt = buildUserPrompt(transcriptionSegments) + '\n\n' + CLIP_ANALYSIS_STRICT_PROMPT;
          await job.updateProgress(45 + attempt * 10);
        }
      }
    }

    // All retries failed
    console.error(`[ClipAnalysis] All attempts failed for project ${projectId}:`, lastError?.message);

    if (dbJobId) {
      await supabase
        .from('jobs')
        .update({
          status: 'failed',
          progress: 0,
          result: { error: lastError?.message },
          updated_at: new Date().toISOString(),
        })
        .eq('id', dbJobId);
    }

    await supabase.from('projects').update({ status: 'failed' }).eq('id', projectId);

    await this.notificationsService.sendPushNotification(
      userId,
      'El análisis falló',
      'No se pudo analizar el video. Inténtalo de nuevo.',
      { type: 'job_failed', projectId, jobId: dbJobId ?? '' },
    );

    throw lastError || new Error('Clip analysis failed after all retries');
  }
}
