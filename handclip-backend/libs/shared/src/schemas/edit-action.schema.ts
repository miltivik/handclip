import { z } from 'zod';

export const EditActionSchema = z.object({
  id: z.string(),
  actionType: z.enum(['cut', 'trim', 'speed', 'fade', 'text', 'transition']),
  targetTime: z.number(),
  duration: z.number().optional(),
  parameters: z.record(z.unknown()),
  aiConfidence: z.number().optional(),
  requiresConfirmation: z.literal(true),
  undoActionId: z.string().optional(),
});

export type EditAction = z.infer<typeof EditActionSchema>;
