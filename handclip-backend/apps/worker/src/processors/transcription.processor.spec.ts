import { buildLocalSegments } from './transcription.processor';
import { SubtitleSegmentSchema } from '@handclip/shared';

describe('buildLocalSegments (localTranscriptionFallback parse)', () => {
  it('returns validated, ordered, non-overlapping SubtitleSegment[] for valid silence boundaries', () => {
    // silence detected in three regions: [0,1] [2,5] [6,9]
    const segments = buildLocalSegments([1, 5, 9], [2, 6, 10], 'proj-123');

    expect(Array.isArray(segments)).toBe(true);
    expect(segments.length).toBe(3);

    // Every element must satisfy the SubtitleSegment schema — this is exactly
    // the typed value localTranscriptionFallback now returns after the
    // SubtitleSegmentSchema.array().parse(...) conversion (no `any[]`).
    expect(() => SubtitleSegmentSchema.array().parse(segments)).not.toThrow();

    const [first] = segments;
    expect(typeof first.id).toBe('string');
    expect(first.id).toContain('proj-123');
    expect(typeof first.text).toBe('string');
    expect(typeof first.startTime).toBe('number');
    expect(typeof first.endTime).toBe('number');
    expect(Array.isArray(first.words)).toBe(true);
    expect(first.language).toBe('unknown');

    // segments are ordered and non-overlapping
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].startTime).toBeGreaterThanOrEqual(segments[i - 1].endTime);
    }
  });

  it('returns an empty array when no silence is detected', () => {
    expect(buildLocalSegments([], [], 'p')).toEqual([]);
  });
});
