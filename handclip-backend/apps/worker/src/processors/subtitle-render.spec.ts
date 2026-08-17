import { describe, expect, it } from 'vitest';
import { SUBTITLE_STYLE_PRESETS } from '@handclip/shared';
import {
  buildKaraokeWords,
  escapeASSText,
  formatASSTime,
  generateASS,
  normalizeSubtitlesForExport,
  shouldRenderAsASS,
  type RenderSubtitleSegment,
} from './subtitle-render';

function seg(partial: Partial<RenderSubtitleSegment> & { id: string }): RenderSubtitleSegment {
  return {
    text: partial.text ?? 'hola mundo',
    startTime: partial.startTime ?? 0,
    endTime: partial.endTime ?? 2,
    words: partial.words,
    id: partial.id,
  };
}

describe('formatASSTime', () => {
  it('formats zero and sub-second values', () => {
    expect(formatASSTime(0)).toBe('0:00:00.00');
    expect(formatASSTime(1.5)).toBe('0:00:01.50');
  });

  it('formats minutes, hours and centiseconds', () => {
    expect(formatASSTime(62.34)).toBe('0:01:02.34');
    expect(formatASSTime(3675.99)).toBe('1:01:15.99');
  });

  it('clamps negatives', () => {
    expect(formatASSTime(-3)).toBe('0:00:00.00');
  });
});

describe('escapeASSText', () => {
  it('neutralizes override-tag syntax', () => {
    expect(escapeASSText('a{\\k20}b')).not.toMatch(/[{}\\]/);
  });

  it('keeps newlines as ASS breaks', () => {
    expect(escapeASSText('línea\notra')).toBe('línea\\Notra');
  });
});

describe('normalizeSubtitlesForExport', () => {
  it('shifts cues by trimStart and scales by speed', () => {
    const result = normalizeSubtitlesForExport(
      [seg({ id: 'a', startTime: 105, endTime: 110 })],
      100,
      200,
      2,
    );
    expect(result[0].startTime).toBeCloseTo(2.5);
    expect(result[0].endTime).toBeCloseTo(5);
  });

  it('drops cues outside the trim window and clamps straddling ones', () => {
    const result = normalizeSubtitlesForExport(
      [
        seg({ id: 'before', startTime: 10, endTime: 20 }),
        seg({ id: 'inside', startTime: 30, endTime: 45 }),
        seg({ id: 'straddle', startTime: 45, endTime: 70 }),
        seg({ id: 'after', startTime: 90, endTime: 95 }),
      ],
      25,
      50,
      1,
    );
    expect(result.map((s) => s.id)).toEqual(['inside', 'straddle']);
    expect(result[0].startTime).toBe(5);
    expect(result[1].endTime).toBe(25); // clamped to window end
  });

  it('scales word timings together with the segment', () => {
    const result = normalizeSubtitlesForExport(
      [
        seg({
          id: 'w',
          startTime: 110,
          endTime: 112,
          words: [
            { word: 'hola', start: 110, end: 110.5, probability: 1 },
            { word: 'mundo', start: 110.6, end: 111.5, probability: 1 },
          ],
        }),
      ],
      100,
      200,
      1,
    );
    expect(result[0].words?.[0].start).toBeCloseTo(10);
    expect(result[0].words?.[1].end).toBeCloseTo(11.5);
  });
});

describe('buildKaraokeWords', () => {
  it('assigns trailing gaps to the preceding word for exact cumulative timing', () => {
    const karaoke = buildKaraokeWords(
      seg({
        id: 'k',
        startTime: 0,
        endTime: 2,
        words: [
          { word: 'hola', start: 0, end: 0.4, probability: 1 },
          { word: 'mundo', start: 0.6, end: 1.4, probability: 1 },
        ],
      }),
    );
    expect(karaoke).not.toBeNull();
    expect(karaoke![0].preDuration).toBeCloseTo(0.6); // 0.4 speech + 0.2 gap
    expect(karaoke![1].preDuration).toBeCloseTo(1.4); // until segment end
  });

  it('returns null when word timings overflow the segment', () => {
    const karaoke = buildKaraokeWords(
      seg({
        id: 'bad',
        startTime: 0,
        endTime: 1,
        words: [
          { word: 'a', start: 0, end: 0.9, probability: 1 },
          { word: 'b', start: 1.0, end: 1.9, probability: 1 },
        ],
      }),
    );
    expect(karaoke).toBeNull();
  });

  it('returns null without word-level data', () => {
    expect(buildKaraokeWords(seg({ id: 'plain' }))).toBeNull();
  });
});

describe('generateASS', () => {
  it('produces a playable ASS document with header, style and events', () => {
    const ass = generateASS(
      [seg({ id: 'e1', startTime: 1.25, endTime: 3.5 })],
      SUBTITLE_STYLE_PRESETS['karaoke-pop'],
    );
    expect(ass).toContain('[Script Info]');
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('PlayResY: 1920');
    expect(ass).toContain('[V4+ Styles]');
    expect(ass).toContain('Style: Default,Arial Black,84,');
    expect(ass).toContain('[Events]');
    expect(ass).toContain('Dialogue: 0,0:00:01.25,0:00:03.50,Default');
    // Karaoke preset uppercases text.
    expect(ass.toUpperCase()).toContain('HOLA MUNDO');
  });

  it('emits karaoke tags when word timings are present', () => {
    const ass = generateASS(
      [
        seg({
          id: 'k',
          startTime: 0,
          endTime: 1,
          words: [
            { word: 'hola', start: 0, end: 0.4, probability: 1 },
            { word: 'mundo', start: 0.5, end: 0.9, probability: 1 },
          ],
        }),
      ],
      SUBTITLE_STYLE_PRESETS['karaoke-pop'],
    );
    expect(ass).toMatch(/\\k50\}HOLA/);
    expect(ass).toMatch(/\\k50\} ?MUNDO/);
  });

  it('falls back to plain text for karaoke preset without words', () => {
    const ass = generateASS(
      [seg({ id: 'p', startTime: 0, endTime: 1 })],
      SUBTITLE_STYLE_PRESETS['karaoke-pop'],
    );
    expect(ass).not.toMatch(/\\k\d+\}/);
  });

  it('emits pop transform tags for the pop animation', () => {
    const ass = generateASS(
      [seg({ id: 'b', startTime: 0, endTime: 1 })],
      SUBTITLE_STYLE_PRESETS['bold-impact'],
    );
    expect(ass).toContain('\\fscx112');
  });

  it('emits fade tags for the fade animation', () => {
    const ass = generateASS(
      [seg({ id: 'f', startTime: 0, endTime: 1 })],
      SUBTITLE_STYLE_PRESETS['minimal-fade'],
    );
    expect(ass).toContain('\\fad(150,150)');
  });
});

describe('shouldRenderAsASS', () => {
  it('classic and invalid values stay on the SRT path', () => {
    expect(shouldRenderAsASS('classic')).toBe(false);
    expect(shouldRenderAsASS(undefined)).toBe(false);
    expect(shouldRenderAsASS('no-existe')).toBe(false);
  });

  it('premium styles use the ASS path', () => {
    expect(shouldRenderAsASS('karaoke-pop')).toBe(true);
    expect(shouldRenderAsASS('minimal-fade')).toBe(true);
  });
});
