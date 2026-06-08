export const MAX_VIDEO_SIZE_MB = 500;
export const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024;
export const MAX_VIDEO_DURATION_SEC = 600; // 10 minutes
export const MAX_CLIP_DURATION_SEC = 90;
export const MIN_CLIP_DURATION_SEC = 15;
export const MAX_CLIPS_PER_PROJECT = 10;
export const MAX_FREE_EXPORTS_PER_MONTH = 3;
export const CHUNK_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export type MonthlyExportLimit = number | null;

export function getMonthlyExportLimit(
  plan?: string | null,
  isAdmin = false,
): MonthlyExportLimit {
  if (isAdmin || plan === 'pro') {
    return null;
  }
  return MAX_FREE_EXPORTS_PER_MONTH;
}
