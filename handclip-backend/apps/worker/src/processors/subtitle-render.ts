import {
  SubtitleSegment,
  SubtitleStylePreset,
  isPremiumSubtitleStyle,
  resolveSubtitleStyle,
} from '@handclip/shared';

export interface RenderSubtitleSegment {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
  words?: { word: string; start: number; end: number; probability: number }[];
}

/**
 * Maps absolute-time subtitle segments onto the exported clip timeline.
 *
 * The rendered video starts at trimStart (0s after setpts=STARTPTS) and
 * speed divides the timeline, so cues must be shifted, scaled and clipped
 * to the [0, (trimEnd - trimStart) / speed] window to stay in sync.
 */
export function normalizeSubtitlesForExport(
  subtitles: RenderSubtitleSegment[],
  trimStart: number,
  trimEnd: number,
  speed: number,
): RenderSubtitleSegment[] {
  const safeSpeed = speed > 0 ? speed : 1;
  const windowDuration = (trimEnd - trimStart) / safeSpeed;

  return subtitles
    .map((segment) => {
      const start = (segment.startTime - trimStart) / safeSpeed;
      const end = (segment.endTime - trimStart) / safeSpeed;
      const words = Array.isArray(segment.words)
        ? segment.words.map((word) => ({
            ...word,
            start: (word.start - trimStart) / safeSpeed,
            end: (word.end - trimStart) / safeSpeed,
          }))
        : undefined;
      return { ...segment, startTime: start, endTime: end, words };
    })
    .filter((segment) => segment.endTime > 0 && segment.startTime < windowDuration)
    .map((segment) => ({
      ...segment,
      startTime: Math.max(0, segment.startTime),
      endTime: Math.min(windowDuration, segment.endTime),
      words: segment.words
        ? segment.words
            .filter((word) => word.end > 0 && word.start < windowDuration)
            .map((word) => ({
              ...word,
              start: Math.max(0, word.start),
              end: Math.min(windowDuration, word.end),
            }))
        : undefined,
    }));
}

/** Formats seconds as ASS timestamp h:mm:ss.cc. */
export function formatASSTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const cs = Math.round((clamped - Math.floor(clamped)) * 100);
  const csSafe = cs > 99 ? 99 : cs;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(csSafe).padStart(2, '0')}`;
}

/** Escapes override-tag breaking characters in ASS dialogue text. */
export function escapeASSText(text: string): string {
  return text
    .replace(/\\/g, '\u2216') // ∖ — keeps visual backslash without closing tags
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\r/g, ' ')
    .replace(/\n/g, '\\N');
}

function toKaraokeCentisecs(durationSeconds: number): number {
  return Math.max(1, Math.round(durationSeconds * 100));
}

interface KaraokeWord {
  text: string;
  /** Duration this word stays "not yet spoken", covering trailing gaps. */
  preDuration: number;
}

/**
 * Builds the per-word karaoke sequence for a segment. Trailing gaps are
 * assigned to the preceding word so cumulative \k timing lands exactly
 * on each next word's start, keeping highlight in sync with speech.
 */
export function buildKaraokeWords(segment: RenderSubtitleSegment): KaraokeWord[] | null {
  const words = segment.words;
  if (!words || words.length === 0) return null;

  const result: KaraokeWord[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const next = words[i + 1];
    const spanEnd = next ? next.start : segment.endTime;
    const preDuration = spanEnd - word.start;
    // Non-positive spans mean unordered/garbage word timings: karaoke
    // cannot be trusted for this segment, fall back to plain text.
    if (!Number.isFinite(preDuration) || preDuration <= 0) return null;
    result.push({ text: word.word, preDuration });
  }

  // Cumulative \k timing must fit inside the segment; drop karaoke when
  // word timings cannot be reconciled (bad ASR data).
  const total = result.reduce((acc, word) => acc + word.preDuration, 0);
  const segmentDuration = segment.endTime - segment.startTime;
  if (result.length === 0 || total > segmentDuration + 0.5 || total <= 0) {
    return null;
  }
  return result;
}

function buildDialogueText(segment: RenderSubtitleSegment, preset: SubtitleStylePreset): string {
  const raw = preset.uppercase ? segment.text.toUpperCase() : segment.text;

  if (preset.animation === 'karaoke') {
    const karaoke = buildKaraokeWords(segment);
    if (karaoke) {
      const words = karaoke
        .map((word) => {
          const text = preset.uppercase ? word.text.toUpperCase() : word.text;
          return `{\\k${toKaraokeCentisecs(word.preDuration)}}${escapeASSText(text)}`;
        })
        .join(' ');
      return `{\\fad(80,0)}${words}`;
    }
    // Fall back to plain highlighted line when word timings are unusable.
    return `{\\fad(80,0)}{\\c${preset.primaryColour}}${escapeASSText(raw)}`;
  }

  if (preset.animation === 'pop') {
    return `{\\fad(40,40)\\t(0,120,\\fscx112\\fscy112)\\t(120,200,\\fscx100\\fscy100)}${escapeASSText(raw)}`;
  }

  if (preset.animation === 'fade') {
    return `{\\fad(150,150)}${escapeASSText(raw)}`;
  }

  return escapeASSText(raw);
}

/** Generates a complete ASS subtitle document for one style preset. */
export function generateASS(
  subtitles: RenderSubtitleSegment[],
  preset: SubtitleStylePreset,
  options?: { playResX?: number; playResY?: number },
): string {
  const playResX = options?.playResX ?? 1080;
  const playResY = options?.playResY ?? 1920;

  const header = [
    '[Script Info]',
    '; Generated by HandClip worker',
    'ScriptType: v4.00+',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
  ].join('\n');

  const styleLine =
    `Style: Default,${preset.fontName},${preset.fontSize},${preset.primaryColour},` +
    `${preset.secondaryColour},${preset.outlineColour},${preset.backColour},` +
    `${preset.bold ? -1 : 0},0,0,0,100,100,0,0,1,${preset.outline},${preset.shadow},2,` +
    `30,30,${preset.marginV},1`;

  const styles = [`[V4+ Styles]`, `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding`, styleLine, ''].join('\n');

  const events = subtitles
    .map((segment) => {
      const start = formatASSTime(segment.startTime);
      const end = formatASSTime(segment.endTime);
      const text = buildDialogueText(segment, preset);
      return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
    })
    .join('\n');

  return `${header}${styles}[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events}\n`;
}

/** True when the render should use the animated ASS pipeline for this style. */
export function shouldRenderAsASS(styleId: unknown): boolean {
  return isPremiumSubtitleStyle(resolveSubtitleStyle(styleId));
}

export type { SubtitleSegment };
