import { z } from 'zod';

export const CreateProjectDtoSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2048).optional(),
  sourceVideoUrl: z.string().url().optional(),
  duration: z.number().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export type CreateProjectDto = z.infer<typeof CreateProjectDtoSchema>;
