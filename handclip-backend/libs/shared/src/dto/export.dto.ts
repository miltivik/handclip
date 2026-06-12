import { z } from 'zod';
import { SubtitleSegmentSchema } from '../schemas/subtitle-segment.schema';
import { MIN_CLIP_DURATION_SEC, MAX_CLIP_DURATION_SEC } from '../constants/limits';

export const ExportClipDtoSchema = z.object({
  clipId: z.string().uuid().optional(),
  trimStart: z.number().min(0),
  trimEnd: z.number().min(0),
  subtitles: z.array(SubtitleSegmentSchema).default([]),
  preset: z.enum(['tiktok', 'reels', 'shorts', 'draft', 'hq']).default('tiktok'),
}).refine(
  (data) => data.trimEnd > data.trimStart,
  { message: 'trimEnd must be greater than trimStart', path: ['trimEnd'] },
).refine(
  (data) => {
    const duration = data.trimEnd - data.trimStart;
    return duration >= MIN_CLIP_DURATION_SEC && duration <= MAX_CLIP_DURATION_SEC;
  },
  {
    message: `Clip duration must be between ${MIN_CLIP_DURATION_SEC}s and ${MAX_CLIP_DURATION_SEC}s`,
    path: ['trimEnd'],
  },
);

export type ExportClipDto = z.infer<typeof ExportClipDtoSchema>;
