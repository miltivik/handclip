import { z } from 'zod';

/**
 * Result contract for the edit-prompt stage.
 *
 * The LLM receives the project transcript plus the current clip list and
 * the user's edit request, and answers with a list of concrete actions
 * that the worker applies to clips / subtitles. Every action references
 * an existing clipId or a 0-based segment index, so unknown references
 * are dropped at validation time instead of corrupting data.
 */
export const EditPromptTrimActionSchema = z.object({
  type: z.literal('trim'),
  clipId: z.string().min(1),
  startTime: z.number().min(0),
  endTime: z.number().min(0),
});

export const EditPromptCaptionActionSchema = z.object({
  type: z.literal('caption'),
  clipId: z.string().min(1),
  caption: z.string().max(300),
});

export const EditPromptSubtitleTextActionSchema = z.object({
  type: z.literal('subtitle_text'),
  segmentIndex: z.number().int().min(0),
  text: z.string().max(500),
});

export const EditPromptActionSchema = z.discriminatedUnion('type', [
  EditPromptTrimActionSchema,
  EditPromptCaptionActionSchema,
  EditPromptSubtitleTextActionSchema,
]);

export const EditPromptResultSchema = z.object({
  summary: z.string().max(1000).default(''),
  actions: z.array(EditPromptActionSchema).max(20).default([]),
});

export type EditPromptTrimAction = z.infer<typeof EditPromptTrimActionSchema>;
export type EditPromptCaptionAction = z.infer<typeof EditPromptCaptionActionSchema>;
export type EditPromptSubtitleTextAction = z.infer<typeof EditPromptSubtitleTextActionSchema>;
export type EditPromptAction = z.infer<typeof EditPromptActionSchema>;
export type EditPromptResult = z.infer<typeof EditPromptResultSchema>;
