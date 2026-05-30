import { z } from 'zod';

const WordSchema = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number(),
  probability: z.number(),
});

export const SubtitleSegmentSchema = z.object({
  id: z.string(),
  text: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  words: z.array(WordSchema),
  language: z.string(),
  speaker: z.string().optional(),
  styleHints: z.record(z.unknown()).optional(),
});

export type SubtitleSegment = z.infer<typeof SubtitleSegmentSchema>;
