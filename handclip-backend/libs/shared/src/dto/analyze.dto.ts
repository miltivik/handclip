import { z } from 'zod';

export const AnalyzeProjectDtoSchema = z.object({
  videoUrl: z.string().url().refine(
    (url) => {
      const parsed = new URL(url);
      return parsed.protocol === 'https:';
    },
    { message: 'videoUrl must use HTTPS protocol' },
  ),
});

export type AnalyzeProjectDto = z.infer<typeof AnalyzeProjectDtoSchema>;
