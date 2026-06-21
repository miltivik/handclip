import { z } from 'zod';
import { ALLOWED_VIDEO_MIMETYPES, MAX_VIDEO_SIZE_BYTES } from '../constants/limits';

export const InitUploadDtoSchema = z.object({
  fileName: z.string().min(1).max(255),
  fileSize: z.number().int().positive().max(MAX_VIDEO_SIZE_BYTES),
  mimeType: z.enum(ALLOWED_VIDEO_MIMETYPES as [string, ...string[]]),
});

export const CompleteUploadDtoSchema = z.object({
  checksum: z.string().min(32).max(64).optional(),
});

export type InitUploadDto = z.infer<typeof InitUploadDtoSchema>;
export type CompleteUploadDto = z.infer<typeof CompleteUploadDtoSchema>;
