import { z } from 'zod';

export const ClipCandidateSchema = z.object({
  id: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  duration: z.number().optional(),
  confidenceScore: z.number().min(0).max(100),
  reasons: z.array(z.string()),
  suggestedCaption: z.string(),
  transcriptSnippet: z.string().optional(),
  moodTags: z.array(z.string()).optional(),
  platformTargets: z.array(z.string()).optional(),
});

export type ClipCandidate = z.infer<typeof ClipCandidateSchema>;
