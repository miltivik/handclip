import { z } from '@handclip/shared';

export const ApiKeyConnectionBodySchema = z.object({
  apiKey: z.string().trim().min(1, 'apiKey is required').max(1024, 'apiKey is too long'),
  model: z.string().trim().min(1, 'model is required').max(256, 'model is too long'),
});

export type ApiKeyConnectionBody = z.infer<typeof ApiKeyConnectionBodySchema>;

export const OpenAiCompatibleConnectionBodySchema = z.object({
  apiKey: z.string().trim().min(1, 'apiKey is required').max(1024, 'apiKey is too long'),
  model: z.string().trim().min(1, 'model is required').max(256, 'model is too long'),
  baseUrl: z
    .string()
    .trim()
    .optional()
    .refine((value) => {
      if (!value) return true; // optional — validated later if needed
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    }, 'baseUrl must be a valid http(s) URL'),
});

export type OpenAiCompatibleConnectionBody = z.infer<typeof OpenAiCompatibleConnectionBodySchema>;

export const SetActiveBodySchema = z.object({
  provider: z.string().min(1, 'provider is required'),
  connectionType: z.enum(['oauth', 'api-key', 'openai-compatible']),
});

export type SetActiveBody = z.infer<typeof SetActiveBodySchema>;

export const ValidateBodySchema = z.object({
  connectionType: z.enum(['api-key', 'openai-compatible']),
  apiKey: z.string().trim().min(1, 'apiKey is required').max(1024, 'apiKey is too long'),
  baseUrl: z.string().trim().optional(),
});
export type ValidateBody = z.infer<typeof ValidateBodySchema>;
