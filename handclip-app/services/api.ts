const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api';

// =============================================================================
// Types
// =============================================================================

export interface Project {
  id: string;
  name: string;
  title?: string;
  description?: string;
  userId: string;
  sourceVideoUrl?: string;
  sourceDuration?: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClipCandidate {
  id: string;
  projectId?: string;
  startTime: number;
  endTime: number;
  duration?: number;
  confidenceScore: number;
  reasons: string[];
  suggestedCaption: string;
  transcriptSnippet?: string;
  moodTags?: string[];
  platformTargets?: string[];
  status?: string;
  selected?: boolean;
}

export interface SubtitleSegment {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
  words?: { word: string; start: number; end: number; probability: number }[];
}

export interface AnalyzeResponse {
  transcriptionJobId: string;
  analysisJobId: string;
  message: string;
}

export interface UploadResponse {
  videoUrl: string;
  projectId: string;
}

export interface JobProgress {
  jobId: string;
  type?: string;
  status: string;
  progress: number;
  returnvalue?: Record<string, unknown>;
  failedReason?: string;
  result?: Record<string, unknown>;
}


// =============================================================================
// Core HTTP helpers
// =============================================================================

async function get<T>(path: string): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(
  path: string,
  body: Record<string, unknown> | FormData,
  multipart = false,
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...(multipart ? {} : { 'Content-Type': 'application/json' }),
      ...(await authHeaders()),
    },
    body: multipart ? (body as FormData) : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await import('./supabase').then((m) => m.supabase.auth.getSession());
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// =============================================================================
// Auth
// =============================================================================

export const api = {
  // ---- Auth ----
  signIn: (email: string, password: string) =>
    post<{ userId: string }>('/auth/signin', { email, password }),

  signUp: (email: string, password: string) =>
    post<{ userId: string }>('/auth/signup', { email, password }),

  signOut: () => post<{ success: boolean }>('/auth/signout', {}),

  getSession: () => get<{ userId: string }>('/auth/session'),

  // ---- Projects ----
  getProjects: () => get<Project[]>('/projects'),

  getProject: (projectId: string) => get<Project>(`/projects/${projectId}`),

  createProject: (name: string, videoUrl?: string) =>
    post<Project>('/projects', { name, videoUrl }),

  deleteProject: (projectId: string) =>
    post<{ success: boolean }>(`/projects/${projectId}`, { _method: 'DELETE' }),

  // ---- Clips ----
  getClips: (projectId: string) =>
    get<ClipCandidate[]>(`/projects/${projectId}/clips`),

  createManualClip: (projectId: string, startTime: number, endTime: number) =>
    post<{ clipId: string }>(`/projects/${projectId}/clips/manual`, { startTime, endTime }),

  selectClip: (projectId: string, clipId: string, selected: boolean) =>
    post<void>(`/projects/${projectId}/clips/${clipId}/select`, { selected }),

  getSubtitles: (projectId: string, clipId: string) =>
    get<SubtitleSegment[]>(`/projects/${projectId}/subtitles/${clipId}`),

  // ---- Analysis ----
  analyze: (projectId: string, videoUrl: string) =>
    post<AnalyzeResponse>(`/projects/${projectId}/analyze`, { videoUrl }),

  getJobStatus: (jobId: string) =>
    get<JobProgress>(`/jobs/${jobId}`),
  // ---- Export ----
  createExportJob: (projectId: string, data: {
    clipId?: string;
    trimStart: number;
    trimEnd: number;
    subtitles: SubtitleSegment[];
    preset: string;
  }) =>
    post<{ jobId: string; exportId: string }>(`/projects/${projectId}/export`, data),

  getExportJob: (exportId: string) =>
    get<{ status: string; progress: number; outputUrl?: string }>(`/exports/${exportId}/status`),

  getExports: (projectId: string) =>
    get<Array<{ id: string; status: string; outputUrl?: string; preset: string; createdAt: string }>>(`/projects/${projectId}/exports`),

  // ---- Uploads ----
  uploadVideoFile: async (uri: string, fileName: string): Promise<UploadResponse> => {
    const formData = new FormData();
    formData.append('video', { uri, name: fileName, type: 'video/mp4' } as any);
    formData.append('name', fileName);
    return post<UploadResponse>('/projects/upload', formData, true);
  },
  // ---- Health ----
  checkHealth: () =>
    get<{ status: string; timestamp: string; checks: Record<string, string> }>('/health'),

  // ---- Auth store helpers (delegated) ----
  auth: {
    setSession: (accessToken: string, refreshToken: string) =>
      import('./supabase').then((m) =>
        m.supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }),
      ),
    getAccessToken: () =>
      import('./supabase').then((m) => m.supabase.auth.getSession()).then((r) => r.data.session?.access_token),
  },
};

// =============================================================================
// SSE for job progress
// =============================================================================

export function subscribeJobProgress(
  jobId: string,
  onProgress: (data: JobProgress) => void,
  onComplete: (result?: Record<string, unknown>) => void,
  onError?: (error: Error) => void,
): () => void {
  const baseUrl = API_BASE.replace('/api', '');
  const url = `${baseUrl}/jobs/${jobId}/progress`;

  // Try EventSource first (works in browser/React Native with polyfill)
  let eventSource: EventSource | null = null;
  let useEventSource = true;

  try {
    eventSource = new EventSource(url);
  } catch {
    useEventSource = false;
  }

  if (useEventSource && eventSource) {
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as JobProgress;
        onProgress(data);
        if (data.status === 'COMPLETED') {
          onComplete(data.result ?? data.returnvalue);
          eventSource?.close();
        } else if (data.status === 'FAILED') {
          onError?.(new Error(data.failedReason ?? 'Processing failed'));
          eventSource?.close();
        }
      } catch {
        // ignore parse errors
      }
    };

    eventSource.onerror = () => {
      // Fallback to polling if EventSource fails
      eventSource?.close();
      startPolling();
    };

    return () => eventSource?.close();
  }

  // Polling fallback
  let active = true;
  let failures = 0;
  const MAX_FAILURES = 3;

  const poll = async () => {
    if (!active) return;
    try {
      const data = await get<JobProgress>(`/jobs/${jobId}`);
      if (!active) return;
      onProgress(data);

      if (data.status === 'COMPLETED') {
        active = false;
        onComplete(data.result ?? data.returnvalue);
      } else if (data.status === 'FAILED') {
        active = false;
        onError?.(new Error(data.failedReason ?? 'Processing failed'));
      }
    } catch {
      failures++;
      if (failures >= MAX_FAILURES) {
        active = false;
        onError?.(new Error('No se pudo conectar con el servidor'));
      }
    }
  };

  function startPolling() {
    const intervalId = setInterval(poll, 2000);
    poll();
    // Return cleanup function
    active = false;
    clearInterval(intervalId);
  }

  // If EventSource is available, the return above handles cleanup.
  // If we fell through to polling, set up the interval now.
  const intervalId = setInterval(poll, 2000);
  poll();

  return () => {
    active = false;
    clearInterval(intervalId);
  };
}
