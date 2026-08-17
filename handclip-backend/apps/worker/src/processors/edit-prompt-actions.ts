import {
  EditPromptAction,
  EditPromptResult,
  EditPromptResultSchema,
  SubtitleSegment,
  getSkillsForStage,
} from '@handclip/shared';

export interface ClipForEditPrompt {
  id: string;
  startTime: number;
  endTime: number;
  confidenceScore: number;
  suggestedCaption: string;
  transcriptSnippet: string;
  status: string;
}

export const EDIT_PROMPT_SYSTEM_PROMPT = `Eres un editor de video short-form. Recibes la transcripción de un proyecto, sus clips candidatos actuales y una petición de edición del usuario. Tu tarea es producir acciones de edición concretas y aplicar SOLO lo que el usuario pidió.

Responde con un JSON exacto de este formato:
{
  "summary": "descripción breve (1-2 frases) de lo que hiciste",
  "actions": [
    { "type": "trim", "clipId": "uuid", "startTime": 12.5, "endTime": 40.0 },
    { "type": "caption", "clipId": "uuid", "caption": "nuevo caption sugerido" },
    { "type": "subtitle_text", "segmentIndex": 3, "text": "texto corregido del segmento" }
  ]
}

Reglas:
- Usa exclusivamente los clipId proporcionados y segmentIndex entre 0 y N-1 de la transcripción.
- "trim": ajusta start/end del clip. Respeta los límites del video y del propio clip: startTime >= 0, endTime > startTime, duración resultante entre 5 y 300 segundos. Ajusta alineando con los timestamps de la transcripción para no cortar palabras.
- "caption": reescribe el caption sugerido del clip según la petición (máx 300 caracteres).
- "subtitle_text": corrige el texto de un segmento de la transcripción (solo para correcciones de palabras o peticiones explícitas del usuario, máx 500 caracteres). No cambies el timing.
- Aplica SOLO las acciones que la petición del usuario justifica. Si la petición no se puede materializar en acciones, devuelve actions vacío y explícalo en summary.
- Máximo 20 acciones.`;

export const EDIT_PROMPT_STRICT_PROMPT = `Tu respuesta anterior no fue un JSON válido. Devuelve SOLO un objeto JSON con las claves "summary" y "actions", sin texto adicional ni markdown. Formato: {"summary":"","actions":[]}`;

export function buildEditPromptUserPrompt(input: {
  prompt: string;
  segments: SubtitleSegment[];
  clips: ClipForEditPrompt[];
}): string {
  const transcript = input.segments.length
    ? input.segments
        .map((seg, i) => `[${i}] [${seg.startTime.toFixed(2)}s - ${seg.endTime.toFixed(2)}s] ${seg.text}`)
        .join('\n')
    : '(sin transcripción disponible)';

  const clips = input.clips.length
    ? input.clips
        .map(
          (clip) =>
            `- clipId: ${clip.id} | ${clip.startTime.toFixed(2)}s → ${clip.endTime.toFixed(2)}s | score: ${clip.confidenceScore} | estado: ${clip.status} | caption: ${clip.suggestedCaption || '(ninguno)'} | fragmento: ${clip.transcriptSnippet || '(ninguno)'}`,
        )
        .join('\n')
    : '(sin clips candidatos)';

  return `Petición del usuario:
"""${input.prompt}"""

Transcripción (segmentIndex entre corchetes):
${transcript}

Clips candidatos actuales:
${clips}

Devuelve el JSON con las acciones de edición que cumplen la petición.`;
}

/** Skills prefix injected before the system prompt (same convention as clip-analysis). */
export function getEditPromptSkillsPrefix(): string {
  const skills = getSkillsForStage('edit-prompt');
  return skills ? `${skills}\n\n` : '';
}

export function parseEditPromptResult(content: string): EditPromptResult {
  const trimmed = content.trim();

  let jsonStr = trimmed;
  if (trimmed.startsWith('```')) {
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) {
      jsonStr = match[1].trim();
    } else {
      const firstBrace = trimmed.indexOf('{');
      const lastBrace = trimmed.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        jsonStr = trimmed.substring(firstBrace, lastBrace + 1);
      }
    }
  } else {
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = trimmed.substring(firstBrace, lastBrace + 1);
    }
  }

  const parsed = JSON.parse(jsonStr);
  return EditPromptResultSchema.parse(parsed);
}

export interface AppliedEditAction {
  action: EditPromptAction;
  applied: boolean;
  reason?: string;
}

/** Minimal surface of the Supabase client used to persist edit actions. */
export interface EditPromptDb {
  from(table: 'clips' | 'subtitles'): {
    update(values: Record<string, unknown>): {
      eq(column: string, value: string): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

/**
 * Applies validated actions against the current project state.
 * Unknown clip ids / out-of-range segment indexes are skipped (and
 * reported) instead of throwing, so one bad LLM reference cannot
 * fail the whole edit.
 */
export async function applyEditActions(
  db: EditPromptDb,
  input: {
    actions: EditPromptAction[];
    clips: ClipForEditPrompt[];
    segments: SubtitleSegment[];
    subtitleRowId: string | null;
    videoDuration: number | null;
  },
): Promise<{ applied: AppliedEditAction[]; skippedCount: number; updatedSegments: SubtitleSegment[] }> {
  const { actions, clips, segments, subtitleRowId, videoDuration } = input;
  const clipById = new Map(clips.map((clip) => [clip.id, clip]));
  const applied: AppliedEditAction[] = [];
  let updatedSegments = segments.map((seg) => ({ ...seg }));

  // Stage subtitle_text edits locally first so multiple actions compose.
  const segmentTextEdits = new Map<number, string>();
  const segmentEdits: AppliedEditAction[] = [];

  for (const action of actions) {
    if (action.type === 'trim') {
      const clip = clipById.get(action.clipId);
      if (!clip) {
        applied.push({ action, applied: false, reason: 'clipId desconocido' });
        continue;
      }
      const maxEnd =
        videoDuration !== null && Number.isFinite(videoDuration) && videoDuration > 0
          ? videoDuration
          : null;
      const start = Math.max(0, action.startTime);
      const end = maxEnd !== null ? Math.min(action.endTime, maxEnd) : action.endTime;
      if (end - start < 5) {
        applied.push({ action, applied: false, reason: 'duración resultante < 5s' });
        continue;
      }
      const { error } = await db
        .from('clips')
        .update({ start_time: start, end_time: end, duration: end - start, user_edited: true })
        .eq('id', action.clipId);
      if (error) {
        applied.push({ action, applied: false, reason: error.message });
        continue;
      }
      clip.startTime = start;
      clip.endTime = end;
      applied.push({ action, applied: true });
    } else if (action.type === 'caption') {
      const clip = clipById.get(action.clipId);
      if (!clip) {
        applied.push({ action, applied: false, reason: 'clipId desconocido' });
        continue;
      }
      const { error } = await db
        .from('clips')
        .update({ suggested_caption: action.caption, user_edited: true })
        .eq('id', action.clipId);
      if (error) {
        applied.push({ action, applied: false, reason: error.message });
        continue;
      }
      clip.suggestedCaption = action.caption;
      applied.push({ action, applied: true });
    } else if (action.type === 'subtitle_text') {
      if (action.segmentIndex < 0 || action.segmentIndex >= updatedSegments.length) {
        segmentEdits.push({ action, applied: false, reason: 'segmentIndex fuera de rango' });
        continue;
      }
      segmentTextEdits.set(action.segmentIndex, action.text);
      updatedSegments = updatedSegments.map((seg, i) =>
        i === action.segmentIndex ? { ...seg, text: action.text } : seg,
      );
      segmentEdits.push({ action, applied: true });
    }
  }

  if (segmentTextEdits.size > 0 && subtitleRowId) {
    const { error } = await db
      .from('subtitles')
      .update({ segments: updatedSegments })
      .eq('id', subtitleRowId);
    if (error) {
      // Revert local staging so the result reflects the DB state.
      updatedSegments = segments.map((seg) => ({ ...seg }));
      for (const edit of segmentEdits) {
        if (edit.applied) edit.applied = false;
      }
    }
  } else if (segmentTextEdits.size > 0) {
    // No subtitle row to persist into: report as skipped.
    updatedSegments = segments.map((seg) => ({ ...seg }));
    for (const edit of segmentEdits) {
      if (edit.applied) {
        edit.applied = false;
        edit.reason = 'el proyecto no tiene transcripción persistida';
      }
    }
  }
  applied.push(...segmentEdits);

  const skippedCount = applied.filter((entry) => !entry.applied).length;
  return { applied, skippedCount, updatedSegments };
}
