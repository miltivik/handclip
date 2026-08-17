import { describe, expect, it } from 'vitest';
import {
  applyEditActions,
  buildEditPromptUserPrompt,
  parseEditPromptResult,
  type ClipForEditPrompt,
  type EditPromptDb,
} from './edit-prompt-actions';
import type { SubtitleSegment } from '@handclip/shared';

function makeSegments(count: number): SubtitleSegment[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `seg-${i}`,
    text: `segmento ${i}`,
    startTime: i * 5,
    endTime: i * 5 + 4,
    words: [],
    language: 'es',
  }));
}

function makeClips(): ClipForEditPrompt[] {
  return [
    {
      id: 'clip-1',
      startTime: 0,
      endTime: 30,
      confidenceScore: 80,
      suggestedCaption: 'caption viejo',
      transcriptSnippet: '...',
      status: 'candidate',
    },
    {
      id: 'clip-2',
      startTime: 60,
      endTime: 120,
      confidenceScore: 65,
      suggestedCaption: '',
      transcriptSnippet: '...',
      status: 'selected',
    },
  ];
}

function makeDb(): EditPromptDb & { calls: { table: string; values: any; id: string }[] } {
  const calls: { table: string; values: any; id: string }[] = [];
  const db: EditPromptDb & { calls: typeof calls } = {
    calls,
    from(table: 'clips' | 'subtitles') {
      return {
        update(values: Record<string, unknown>) {
          return {
            eq(_column: string, value: string) {
              calls.push({ table, values, id: String(value) });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  return db;
}

describe('parseEditPromptResult', () => {
  it('parses a plain JSON response', () => {
    const result = parseEditPromptResult(
      JSON.stringify({
        summary: 'recortado',
        actions: [{ type: 'caption', clipId: 'clip-1', caption: 'nuevo' }],
      }),
    );
    expect(result.summary).toBe('recortado');
    expect(result.actions).toHaveLength(1);
  });

  it('extracts JSON from markdown code fences', () => {
    const result = parseEditPromptResult(
      '```json\n{"summary":"ok","actions":[]}\n```',
    );
    expect(result.summary).toBe('ok');
    expect(result.actions).toEqual([]);
  });

  it('extracts JSON embedded in surrounding prose', () => {
    const result = parseEditPromptResult(
      'Aquí tienes: {"summary":"ok","actions":[{"type":"subtitle_text","segmentIndex":0,"text":"hola"}]} ¡listo!',
    );
    expect(result.actions[0]).toMatchObject({ type: 'subtitle_text', segmentIndex: 0 });
  });

  it('rejects malformed JSON', () => {
    expect(() => parseEditPromptResult('no json at all')).toThrow();
  });

  it('rejects unknown action types', () => {
    const raw = JSON.stringify({ summary: '', actions: [{ type: 'explode' }] });
    expect(() => parseEditPromptResult(raw)).toThrow();
  });
});

describe('buildEditPromptUserPrompt', () => {
  it('includes the prompt, transcript indexes and clip ids', () => {
    const userPrompt = buildEditPromptUserPrompt({
      prompt: 'acorta el primer clip',
      segments: makeSegments(2),
      clips: makeClips(),
    });
    expect(userPrompt).toContain('acorta el primer clip');
    expect(userPrompt).toContain('[0] [0.00s - 4.00s] segmento 0');
    expect(userPrompt).toContain('clipId: clip-1');
  });
});

describe('applyEditActions', () => {
  it('applies trim with clamping to video duration and flags user_edited', async () => {
    const db = makeDb();
    const clips = makeClips();
    const result = await applyEditActions(db, {
      actions: [
        { type: 'trim', clipId: 'clip-1', startTime: -5, endTime: 1000 },
      ],
      clips,
      segments: makeSegments(3),
      subtitleRowId: 'subs-1',
      videoDuration: 200,
    });
    expect(result.applied[0].applied).toBe(true);
    const clipUpdate = db.calls.find((c) => c.table === 'clips');
    expect(clipUpdate?.values).toMatchObject({ start_time: 0, end_time: 200, duration: 200, user_edited: true });
    expect(clips[0].endTime).toBe(200);
  });

  it('rejects trims shorter than 5 seconds', async () => {
    const db = makeDb();
    const result = await applyEditActions(db, {
      actions: [{ type: 'trim', clipId: 'clip-1', startTime: 10, endTime: 12 }],
      clips: makeClips(),
      segments: makeSegments(3),
      subtitleRowId: null,
      videoDuration: null,
    });
    expect(result.applied[0].applied).toBe(false);
    expect(result.skippedCount).toBe(1);
    expect(db.calls).toHaveLength(0);
  });

  it('skips unknown clip ids without failing the batch', async () => {
    const db = makeDb();
    const result = await applyEditActions(db, {
      actions: [
        { type: 'caption', clipId: 'ghost', caption: 'x' },
        { type: 'caption', clipId: 'clip-2', caption: 'buen clip' },
      ],
      clips: makeClips(),
      segments: makeSegments(3),
      subtitleRowId: null,
      videoDuration: null,
    });
    expect(result.applied[0].applied).toBe(false);
    expect(result.applied[1].applied).toBe(true);
    expect(result.skippedCount).toBe(1);
  });

  it('applies subtitle text edits in a single persisted update', async () => {
    const db = makeDb();
    const segments = makeSegments(3);
    const result = await applyEditActions(db, {
      actions: [
        { type: 'subtitle_text', segmentIndex: 1, text: 'corregido' },
        { type: 'subtitle_text', segmentIndex: 2, text: 'también corregido' },
      ],
      clips: makeClips(),
      segments,
      subtitleRowId: 'subs-1',
      videoDuration: null,
    });
    expect(result.applied.every((a) => a.applied)).toBe(true);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]).toMatchObject({ table: 'subtitles', id: 'subs-1' });
    expect((db.calls[0].values.segments as SubtitleSegment[])[1].text).toBe('corregido');
    // Original array is not mutated.
    expect(segments[1].text).toBe('segmento 1');
  });

  it('skips out-of-range segment indexes', async () => {
    const db = makeDb();
    const result = await applyEditActions(db, {
      actions: [{ type: 'subtitle_text', segmentIndex: 99, text: 'x' }],
      clips: makeClips(),
      segments: makeSegments(2),
      subtitleRowId: 'subs-1',
      videoDuration: null,
    });
    expect(result.applied[0].applied).toBe(false);
    expect(db.calls).toHaveLength(0);
  });
});
