import { useEffect, useRef } from 'react';
import { api, subscribeJobProgress, PollerCallbacks } from '../services/api';
import { onNetworkReconnect } from './useNetworkStatus';
import { useAuthStore } from '../stores/auth.store';
import { useJobsStore, PendingJob, PendingJobType } from '../stores/jobs.store';
import { useProjectStore } from '../stores/project.store';

function statusFromString(s: string): PendingJob['status'] {
  const upper = s.toUpperCase();
  if (upper === 'QUEUED' || upper === 'ACTIVE' || upper === 'COMPLETED' || upper === 'FAILED') {
    return upper.toLowerCase() as PendingJob['status'];
  }
  return 'queued';
}

function typeFromString(t: string | undefined): PendingJobType | null {
  if (t === 'clip_analysis' || t === 'render' || t === 'edit_prompt') return t;
  return null;
}

interface ResumeCallbacks {
  onJobComplete?: (job: PendingJob) => void;
  onJobFailed?: (job: PendingJob, reason?: string) => void;
}

const activePollers = new Map<string, () => void>();

function stopPolling(jobId: string) {
  const stop = activePollers.get(jobId);
  if (stop) {
    stop();
    activePollers.delete(jobId);
  }
}

function stopAllPollers() {
  for (const stop of activePollers.values()) stop();
  activePollers.clear();
}

export function startPollingJob(job: PendingJob, cb: ResumeCallbacks = {}): () => void {
  if (activePollers.has(job.jobId)) return () => stopPolling(job.jobId);

  const jobsStore = useJobsStore.getState();
  const callbacks: PollerCallbacks = {
    onProgress: (data, status) => {
      if (status === 'offline') {
        jobsStore.updateJob(job.jobId, { status: 'offline' });
        return;
      }
      const s = statusFromString(data.status);
      const projectId = data.projectId ?? job.projectId;
      const updated: PendingJob = {
        ...job,
        status: s,
        progress: data.progress ?? job.progress,
        projectId,
      };
      if (s === 'completed') {
        jobsStore.removeJob(job.jobId);
        stopPolling(job.jobId);
        if (projectId) {
          useProjectStore.getState().fetchProject(projectId).catch(() => null);
          useProjectStore.getState().fetchClips(projectId).catch(() => null);
        }
        cb.onJobComplete?.(updated);
      } else if (s === 'failed') {
        jobsStore.updateJob(job.jobId, { status: 'failed' });
        cb.onJobFailed?.(updated, data.failedReason);
      } else {
        jobsStore.updateJob(job.jobId, { status: s, progress: data.progress ?? 0 });
      }
    },
    onError: (err) => {
      const updated: PendingJob = { ...job, status: 'failed' };
      jobsStore.updateJob(job.jobId, { status: 'failed' });
      cb.onJobFailed?.(updated, err.message);
    },
    onComplete: (result) => {
      const updated: PendingJob = { ...job, status: 'completed' };
      jobsStore.removeJob(job.jobId);
      if (job.projectId) {
        useProjectStore.getState().fetchProject(job.projectId).catch(() => null);
        useProjectStore.getState().fetchClips(job.projectId).catch(() => null);
      }
      cb.onJobComplete?.(updated);
      void result;
    },
  };

  const stop = subscribeJobProgress(job.jobId, callbacks);
  activePollers.set(job.jobId, stop);
  return stop;
}

/**
 * Top-level hook: when authenticated, fetch active jobs from the server and
 * resume polling for any locally persisted job not already running. Also
 * re-runs on network reconnect.
 */
export function useResumeActiveJobs(): void {
  const userId = useAuthStore((s) => s.user?.id);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const ranForUser = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !userId) {
      stopAllPollers();
      ranForUser.current = null;
      return;
    }
    if (ranForUser.current === userId) return;
    ranForUser.current = userId;

    const resume = async () => {
      const jobsStore = useJobsStore.getState();
      // 1. Pull active jobs from server.
      let serverActive: Awaited<ReturnType<typeof api.getActiveJobs>> = [];
      try {
        serverActive = await api.getActiveJobs();
      } catch {
        // Offline — that's fine, we'll resume from local store.
      }

      // 2. Merge: for any server job not already known, persist it.
      const known = new Set(jobsStore.jobs.map((j) => j.jobId));
      for (const job of serverActive) {
        const t = typeFromString(job.type);
        if (!t) continue;
        if (known.has(job.jobId)) continue;
        jobsStore.addJob({
          jobId: job.jobId,
          projectId: job.projectId,
          type: t,
          status: statusFromString(job.status),
          progress: job.progress ?? 0,
          clientRequestId: job.clientRequestId,
        });
      }

      // 3. Drop server-side completed/failed that are still in local store
      //    (would happen if app was killed mid-completion).
      const activeIds = new Set(serverActive.map((j) => j.jobId));
      for (const local of jobsStore.jobs) {
        if (!activeIds.has(local.jobId) && (local.status === 'queued' || local.status === 'active' || local.status === 'offline')) {
          // Job no longer active on the server: query its latest status.
          try {
            const latest = await api.getJob(local.jobId);
            const s = statusFromString(latest.status);
            if (s === 'completed') {
              jobsStore.removeJob(local.jobId);
              if (local.projectId) {
                useProjectStore.getState().fetchProject(local.projectId).catch(() => null);
                useProjectStore.getState().fetchClips(local.projectId).catch(() => null);
              }
            } else if (s === 'failed') {
              jobsStore.updateJob(local.jobId, { status: 'failed' });
            } else {
              jobsStore.updateJob(local.jobId, { status: s, progress: latest.progress ?? 0 });
            }
          } catch {
            // Leave it for next reconnect.
          }
        }
      }

      // 4. Start polling for every persisted job that isn't already running.
      for (const job of useJobsStore.getState().jobs) {
        if (job.status === 'completed' || job.status === 'failed') continue;
        startPollingJob(job);
      }
    };

    void resume();
    const off = onNetworkReconnect(() => {
      // Re-pull server state and re-subscribe.
      for (const job of useJobsStore.getState().jobs) {
        if (job.status === 'completed' || job.status === 'failed') continue;
        startPollingJob(job);
      }
    });
    return () => {
      off();
    };
  }, [isAuthenticated, userId]);
}
