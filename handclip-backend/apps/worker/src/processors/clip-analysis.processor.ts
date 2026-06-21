import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ClipCandidate, ClipCandidateSchema, SubtitleSegment } from '@handclip/shared';
import { SupabaseService } from '../modules/supabase/supabase.service';
import { providerManager, StageTask } from '../providers/provider-manager';
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
  videoUrl: string;
  transcriptionSegments?: SubtitleSegment[];
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

@Processor('clip-analysis', { lockDuration: 600000, lockRenewTime: 30000 })
export class ClipAnalysisProcessor extends WorkerHost {
  constructor(private readonly supabaseService: SupabaseService) {
    super();
  }

  async process(job: Job<ClipAnalysisJobData>): Promise<{ clips: ClipCandidate[] }> {
    const { projectId, transcriptionSegments } = job.data;
    const supabase = this.supabaseService.getServiceRoleClient();

    // Look up pre-created clip_analysis DB record (from enqueueAnalysis)
    const { data: existingJob } = await supabase
      .from('jobs')
      .select('id')
      .eq('project_id', projectId)
      .eq('type', 'clip_analysis')
      .eq('status', 'queued')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    let dbJobId: string | undefined = existingJob?.id;

    if (dbJobId) {
      await supabase
        .from('jobs')
        .update({ status: 'active', progress: 10, bullmq_id: job.id })
        .eq('id', dbJobId);
    } else {
      // Fallback: create record if pre-created one doesn't exist
      const { data: newJob } = await supabase
        .from('jobs')
        .insert({
          project_id: projectId,
          type: 'clip_analysis',
          status: 'active',
          progress: 10,
          bullmq_id: job.id,
        })
        .select('id')
        .single();
      dbJobId = newJob?.id;
    }

    await job.updateProgress(10);
    console.log(`[ClipAnalysis] Analyzing clips for project ${projectId}`);

    // Validate we have transcription data
    if (!transcriptionSegments || transcriptionSegments.length === 0) {
      if (dbJobId) {
        await supabase
          .from('jobs')
          .update({ status: 'completed', progress: 100, result: { clips_count: 0 }, updated_at: new Date().toISOString() })
          .eq('id', dbJobId);
      }
      await supabase.from('projects').update({ status: 'ready' }).eq('id', projectId);
      await job.updateProgress(50);
      console.warn(`[ClipAnalysis] No transcription segments for project ${projectId}, returning empty`);
      await job.updateProgress(100);
      return { clips: [] };
    }

    if (dbJobId) {
      await supabase.from('jobs').update({ progress: 30 }).eq('id', dbJobId);
    }
    await job.updateProgress(30);
    console.log(`[ClipAnalysis] Processing ${transcriptionSegments.length} transcription segments`);

    // Build the task for ProviderManager
    const task: StageTask = {
      stage: 'clip-analysis',
      systemPrompt: CLIP_ANALYSIS_SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(transcriptionSegments),
      maxTokens: 4000,
      temperature: 0.3,
    };

    if (dbJobId) {
      await supabase.from('jobs').update({ progress: 40 }).eq('id', dbJobId);
    }
    await job.updateProgress(40);

    // Call LLM with multi-provider retry (3 attempts)
    const MAX_ATTEMPTS = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        // Attempt 0: default prompt
        // Attempt 1: strict prompt
        // Attempt 2: strict prompt + force Anthropic first (most capable for structured JSON)
        if (attempt === 1) {
          task.userPrompt = buildUserPrompt(transcriptionSegments) + '\n\n' + CLIP_ANALYSIS_STRICT_PROMPT;
        }
        if (attempt === 2) {
          task.userPrompt = buildUserPrompt(transcriptionSegments) + '\n\n' + CLIP_ANALYSIS_STRICT_PROMPT;
          task.forceProvider = 'anthropic';
        }

        const result = await providerManager.callWithFallback(task);

        if (dbJobId) {
          await supabase.from('jobs').update({ progress: 60 }).eq('id', dbJobId);
        }
        await job.updateProgress(60);
        console.log(`[ClipAnalysis] Received response from ${result.provider} (${result.model}) on attempt ${attempt + 1}`);
        console.log(
          `[ClipAnalysis] Usage: ${result.usage.inputTokens} input tokens, ${result.usage.outputTokens} output tokens`,
        );

        const clips = parseAndValidateClips(result.content);

        if (dbJobId) {
          await supabase.from('jobs').update({ progress: 80 }).eq('id', dbJobId);
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

        clips.sort((a, b) => (b.confidenceScore || 0) - (a.confidenceScore || 0));
        await supabase.from('projects').update({ status: 'ready' }).eq('id', projectId);

        if (dbJobId) {
          await supabase
            .from('jobs')
            .update({
              status: 'completed',
              progress: 100,
              result: { clips_count: clips.length, provider: result.provider, attempts: attempt + 1 },
              updated_at: new Date().toISOString(),
            })
            .eq('id', dbJobId);
        }
        await job.updateProgress(100);
        console.log(`[ClipAnalysis] Completed for project ${projectId}`);

        return { clips };
      } catch (err: any) {
        lastError = err;
        console.warn(`[ClipAnalysis] Attempt ${attempt + 1}/${MAX_ATTEMPTS} failed: ${err.message}`);

        if (dbJobId) {
          await supabase.from('jobs').update({ progress: 45 + attempt * 10 }).eq('id', dbJobId);
        }
        await job.updateProgress(45 + attempt * 10);
      }
    }

    // All attempts failed — create a fallback clip from the longest segment
    console.warn(`[ClipAnalysis] All ${MAX_ATTEMPTS} attempts failed. Creating fallback clip from longest segment.`);

    const fallbackClips = this.createFallbackClip(projectId, transcriptionSegments);
    // ponytail: mark the job as degraded (not failed) when fallback is used.
    // The fallback creates a synthetic clip from the longest segment —
    // it's a degraded result, not a real LLM analysis. Surfacing this
    // via `result.degraded: true` lets the UI show a warning; the user
    // can then retry or trim the segment manually.
    if (dbJobId) {
      await supabase
        .from('jobs')
        .update({
          status: 'completed',
          progress: 100,
          result: {
            clips_count: fallbackClips.length,
            fallback: true,
            degraded: true,
            error: lastError?.message,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', dbJobId);
    }
    await job.updateProgress(100);

    return { clips: fallbackClips };
  }

  /**
   * Creates a single fallback clip from the longest transcription segment.
   * Used when all LLM attempts fail — ensures the user always gets at least one clip.
   */
  private createFallbackClip(
    projectId: string,
    segments: SubtitleSegment[],
  ): ClipCandidate[] {
    if (!segments || segments.length === 0) return [];

    const longest = segments.reduce((longest, seg) =>
      (seg.endTime - seg.startTime) > (longest.endTime - longest.startTime) ? seg : longest,
    );

    const duration = longest.endTime - longest.startTime;
    console.log(
      `[ClipAnalysis] Fallback clip from longest segment: ${longest.startTime}s–${longest.endTime}s (${duration.toFixed(1)}s)`,
    );

    return [{
      id: `fallback-${projectId}`,
      startTime: longest.startTime,
      endTime: longest.endTime,
      duration,
      confidenceScore: 30,
      reasons: ['fallback_longest_segment'],
      suggestedCaption: longest.text.substring(0, 150),
      transcriptSnippet: longest.text,
      moodTags: [],
      platformTargets: ['tiktok'],
    }];
  }
}