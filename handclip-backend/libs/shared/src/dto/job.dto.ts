export class JobStatusDto {
  jobId: string;
  type?: string;
  status: string;
  progress: number;
  result?: Record<string, unknown>;
  returnvalue?: unknown;
  failedReason?: string;
}
