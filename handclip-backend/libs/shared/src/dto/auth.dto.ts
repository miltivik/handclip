import { z } from 'zod';

export const LoginDtoSchema = z.object({
  email: z.string().email().max(254),
});

export const VerifyDtoSchema = z.object({
  email: z.string().email().max(254),
  token: z.string().min(6).max(8),
});

export type LoginDto = z.infer<typeof LoginDtoSchema>;
export type VerifyDto = z.infer<typeof VerifyDtoSchema>;
