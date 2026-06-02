const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api';

// =============================================================================
// Types
// =============================================================================

export interface Project {
  id: string;
  user_id: string;
  name: string;
  video_url: string;
  thumbnail_url: string | null;
  duration: number | null;
  created_at: string;
  updated_at: string;
}

export interface ClipCandidate {
  id: string;
  project_id: string;
  start_time: number;
  end_time: number;
  score: number;
  thumbnail_url: string | null;
  created_at: string;
}

export interface SubtitleSegment {
  start: number;
  end: number;
  text: string;
}

export interface AnalyzeResponse {
  jobId: string;
}

export interface UploadResponse {
  url: string;
  path: string;
}

export interface JobProgress {
  jobId: string;
  status: 'QUEUED' | 'ACTIVE' | 'Completed' | 'Failed' | 'COMPLETED' | 'FAILED';
  progress: number;
  returnvalue?: Record<string, unknown>;
  failedReason?: string;
  result?: Record<string, unknown>;
}

export type AiProvider = 'openai-codex' | 'anthropic';

export interface AiConnection {
  provider: AiProvider;
  isActive: boolean;
  connectedAt: string;
}

export interface OAuthAttempt {
  id: string;
  provider: AiProvider;
  status: 'initializing' | 'awaiting-user' | 'connected' | 'failed' | 'cancelled' | 'expired';
  authorizationUrl?: string;
  userCode?: string;
  verificationUri?: string;
  intervalSeconds?: number;
  expiresAt: string;
  error?: string;
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

async function patch<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function del<T>(path: string): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    },
  });
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`);
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

  createProject: (name: string, videoUrl: string) =>
    post<Project>('/projects', { name, video_url: videoUrl }),

  deleteProject: (projectId: string) =>
    post<{ success: boolean }>(`/projects/${projectId}`, { _method: 'DELETE' }),

  // ---- Clips ----
  getClips: (projectId: string) =>
    get<ClipCandidate[]>(`/projects/${projectId}/clips`),
  createManualClip: (projectId: string, startTime: number, endTime: number) =>
    post<{ clipId: string }>(`/projects/${projectId}/clips/manual`, { startTime, endTime }),
  // ---- Analysis ----
  analyze: (projectId: string, videoUrl: string) =>
    post<AnalyzeResponse>(`/projects/${projectId}/analyze`, { videoUrl }),

  uploadVideoFile: async (file: {
    uri: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
  }) => {
    const form = new FormData();
    form.append('video', {
      uri: file.uri,
      name: file.fileName,
      type: file.mimeType,
    } as unknown as Blob);
    form.append('name', file.fileName.replace(/\.[^/.]+$/, ''));
    return post<{ projectId: string; videoUrl: string }>(
      '/projects/upload',
      form,
      true,
    );
  },
  // ---- Uploads ----
  getUploadUrl: (filename: string, contentType: string) =>
    post<UploadResponse>('/uploads/url', { filename, content_type: contentType }),

  uploadFile: async (file: { uri: string; name: string; type: string }) => {
    // 1. Get signed URL
    const { url, path } = await api.getUploadUrl(file.name, file.type);

    // 2. PUT file to storage
    const res = await fetch(url, {
      method: 'PUT',
      body: await (await fetch(file.uri)).blob(),
      headers: { 'Content-Type': file.type },
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);

    return { url: path };
  },

  // ---- Audio ----
  uploadAudioFile: async (file: { uri: string; fileName?: string; mimeType?: string; fileSize?: number }): Promise<{ audioUrl: string }> => {
    // Reuse uploadFile — it works for any file type (audio included)
    const name = file.fileName ?? 'audio.mp3';
    const type = file.mimeType ?? 'audio/mpeg';
    const { url } = await api.uploadFile({ uri: file.uri, name, type });
    return { audioUrl: url };
  },
  // ---- Health ----
  checkHealth: () =>
    get<{ status: string; timestamp: string; checks: Record<string, string> }>('/health'),

  // ---- AI provider connections ----
  getAiConnections: () => get<AiConnection[]>('/ai-connections'),
  startAiConnection: (provider: AiProvider) =>
    post<OAuthAttempt>(`/ai-connections/${provider}/start`, {}),
  getAiConnectionAttempt: (provider: AiProvider, id: string) =>
    get<OAuthAttempt>(`/ai-connections/${provider}/attempts/${id}`),
  submitAiConnectionInput: (provider: AiProvider, id: string, input: string) =>
    post<OAuthAttempt>(`/ai-connections/${provider}/attempts/${id}/input`, { input }),
  setActiveAiConnection: (provider: AiProvider) =>
    patch<void>('/ai-connections/active', { provider }),
  disconnectAiConnection: (provider: AiProvider) =>
    del<void>(`/ai-connections/${provider}`),

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
