export enum JobType {
  TRANSCRIPTION = 'TRANSCRIPTION',
  CLIP_ANALYSIS = 'CLIP_ANALYSIS',
  RENDER = 'RENDER',
  EDIT_PROMPT = 'EDIT_PROMPT',
}

export enum JobStatus {
  QUEUED = 'QUEUED',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export const ACTIVE_JOB_STATUSES = ['queued', 'active'] as const;
export const TERMINAL_JOB_STATUSES = ['completed', 'failed'] as const;

export type JobStatusLower = 'queued' | 'active' | 'completed' | 'failed';
