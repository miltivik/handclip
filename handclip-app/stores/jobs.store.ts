import { create } from 'zustand';
import type * as ZustandMiddleware from 'zustand/middleware';
import { safeStorage } from '../lib/safe-storage';

declare const require: <T>(name: string) => T;

const { createJSONStorage, persist } =
  require<typeof ZustandMiddleware>('zustand/middleware');

export type PendingJobType = 'clip_analysis' | 'render' | 'edit_prompt';
export type PendingJobStatus = 'queued' | 'active' | 'offline' | 'completed' | 'failed';

export interface PendingJob {
  jobId: string;
  projectId: string;
  type: PendingJobType;
  status: PendingJobStatus;
  progress: number;
  createdAt: string;
  clientRequestId?: string;
  // Optional routing metadata (e.g. preset for export).
  meta?: Record<string, string>;
}

/**
 * A "pending request" is a *user intent* to start a long job. It exists
 * before the POST is sent and survives even if the app is killed between
 * tap and network response. When the server returns a jobId, the
 * request is promoted to a PendingJob.
 *
 * The request's `clientRequestId` is the idempotency key: if the user
 * retries (double-tap, retry button, app reopened), the same id is sent
 * and the server returns the same job.
 */
export interface PendingRequest {
  clientRequestId: string;
  projectId: string;
  type: PendingJobType;
  createdAt: string;
  // Optional routing metadata (e.g. preset for export).
  meta?: Record<string, string>;
}

interface JobsState {
  jobs: PendingJob[];
  requests: PendingRequest[];

  addJob: (job: Omit<PendingJob, 'status' | 'progress' | 'createdAt'> & {
    status?: PendingJobStatus;
    progress?: number;
    createdAt?: string;
  }) => void;
  updateJob: (
    jobId: string,
    patch: Partial<Pick<PendingJob, 'status' | 'progress'>>,
  ) => void;
  removeJob: (jobId: string) => void;
  clearCompleted: () => void;
  getByProject: (projectId: string) => PendingJob[];
  hasActiveJobForProject: (projectId: string, types?: PendingJobType[]) => boolean;

  // ---- Pending requests (idempotency-before-POST) ----
  recordRequest: (req: PendingRequest) => void;
  consumeRequest: (clientRequestId: string) => PendingRequest | undefined;
  // Look up by composite key (project + type + crr). If a matching request
  // exists, reuse its clientRequestId; otherwise return undefined.
  findRequest: (projectId: string, type: PendingJobType) => PendingRequest | undefined;
  dropRequest: (clientRequestId: string) => void;
}

function dedupeById(list: PendingJob[]): PendingJob[] {
  const map = new Map<string, PendingJob>();
  for (const job of list) {
    map.set(job.jobId, job);
  }
  return Array.from(map.values());
}

function dedupeByCrr(list: PendingRequest[]): PendingRequest[] {
  const map = new Map<string, PendingRequest>();
  for (const req of list) {
    map.set(req.clientRequestId, req);
  }
  return Array.from(map.values());
}

// Window of time in which a "pending request" is considered the same
// user intent as a fresh tap. After this, the request is stale and a
// new clientRequestId should be generated.
const REQUEST_DEDUPE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export const useJobsStore = create<JobsState>()(
  persist(
    (set, get) => ({
      jobs: [],
      requests: [],

      addJob: (input) => {
        const next: PendingJob = {
          jobId: input.jobId,
          projectId: input.projectId,
          type: input.type,
          status: input.status ?? 'queued',
          progress: input.progress ?? 0,
          createdAt: input.createdAt ?? new Date().toISOString(),
          clientRequestId: input.clientRequestId,
          meta: input.meta,
        };
        set((state) => ({
          jobs: dedupeById([...state.jobs.filter((j) => j.jobId !== next.jobId), next]),
        }));
      },

      updateJob: (jobId, patch) => {
        set((state) => ({
          jobs: state.jobs.map((j) => (j.jobId === jobId ? { ...j, ...patch } : j)),
        }));
      },

      removeJob: (jobId) => {
        set((state) => ({ jobs: state.jobs.filter((j) => j.jobId !== jobId) }));
      },

      clearCompleted: () => {
        set((state) => ({
          jobs: state.jobs.filter((j) => j.status !== 'completed' && j.status !== 'failed'),
        }));
      },

      getByProject: (projectId) => get().jobs.filter((j) => j.projectId === projectId),

      hasActiveJobForProject: (projectId, types) => {
        const list = get().jobs.filter((j) => j.projectId === projectId);
        return list.some(
          (j) =>
            (j.status === 'queued' || j.status === 'active' || j.status === 'offline') &&
            (!types || types.includes(j.type)),
        );
      },

      recordRequest: (req) => {
        set((state) => ({
          requests: dedupeByCrr([
            ...state.requests.filter((r) => r.clientRequestId !== req.clientRequestId),
            req,
          ]),
        }));
      },

      consumeRequest: (clientRequestId) => {
        const req = get().requests.find((r) => r.clientRequestId === clientRequestId);
        if (req) {
          set((state) => ({
            requests: state.requests.filter((r) => r.clientRequestId !== clientRequestId),
          }));
        }
        return req;
      },

      findRequest: (projectId, type) => {
        const now = Date.now();
        const req = get().requests.find(
          (r) =>
            r.projectId === projectId &&
            r.type === type &&
            now - new Date(r.createdAt).getTime() < REQUEST_DEDUPE_WINDOW_MS,
        );
        return req;
      },

      dropRequest: (clientRequestId) => {
        set((state) => ({
          requests: state.requests.filter((r) => r.clientRequestId !== clientRequestId),
        }));
      },
    }),
    {
      name: 'handclip-jobs-cache',
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({ jobs: state.jobs, requests: state.requests }),
    },
  ),
);

export function newClientRequestId(): string {
  // RFC 4122-ish; not cryptographic, just stable + unique per call.
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `crr-${Date.now().toString(36)}-${rand()}-${rand()}`;
}

/**
 * Returns a clientRequestId for a (projectId, type) action. If a recent
 * request already exists for the same action, reuses it. Otherwise
 * creates a new one, persists it, and returns it.
 *
 * This is the entry point that makes idempotency work even when the
 * mobile app loses the response from a successful POST: the next
 * attempt will reuse the same clientRequestId and the server will
 * return the same job.
 */
export function getOrCreateClientRequestId(
  projectId: string,
  type: PendingJobType,
  meta?: Record<string, string>,
): string {
  const store = useJobsStore.getState();
  const existing = store.findRequest(projectId, type);
  if (existing) {
    return existing.clientRequestId;
  }
  const crr = newClientRequestId();
  store.recordRequest({
    clientRequestId: crr,
    projectId,
    type,
    createdAt: new Date().toISOString(),
    meta,
  });
  return crr;
}
