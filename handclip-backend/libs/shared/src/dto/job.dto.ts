export class JobStatusDto {
  jobId: string;
  type?: string;
  status: string;
  progress: number;
  result?: Record<string, unknown>;
  returnvalue?: unknown;
  failedReason?: string;
  clientRequestId?: string;
  projectId?: string;
  updatedAt?: string;
}

export type ActiveJobType = 'transcription' | 'clip_analysis' | 'render' | 'edit_prompt';
export type ActiveJobStatus = 'queued' | 'active' | 'completed' | 'failed';

export class ActiveJobDto {
  jobId: string;
  projectId: string;
  type: ActiveJobType;
  status: string;
  progress: number;
  result?: Record<string, unknown>;
  failedReason?: string;
  updatedAt: string;
  clientRequestId?: string;
}
