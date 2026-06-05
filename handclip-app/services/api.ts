const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api';

// =============================================================================
// Types
// =============================================================================

export interface Project {
  id: string;
  userId: string;
  name: string;
  description?: string;
  sourceVideoUrl?: string;
  sourceDuration?: number;
  status?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClipCandidate {
  id: string;
  projectId: string;
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
  createdAt?: string;
}

export interface SubtitleSegment {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
  words?: { word: string; start: number; end: number; probability: number }[];
  language?: string;
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

export interface ExportItem {
  id: string;
  project_id: string;
  clip_id: string | null;
  preset: string;
  status: string;
  output_url: string | null;
  file_size: number | null;
  duration: number | null;
  created_at: string;
  completed_at: string | null;
  project_title: string;
};
export interface QuotaInfo {
  exportsThisMonth: number;
  maxExports: number;
  plan: string;
}
// =============================================================================
// Core HTTP helpers
// =============================================================================

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
  getQuota: () => get<QuotaInfo>('/auth/quota'),

  // ---- Projects ----
  getProjects: () => get<Project[]>('/projects'),

  getProject: (projectId: string) => get<Project>(`/projects/${projectId}`),

  createProject: (name: string, videoUrl: string) =>
    post<Project>('/projects', { name, sourceVideoUrl: videoUrl }),

  deleteProject: (projectId: string) =>
    del<void>(`/projects/${projectId}`),

  // ---- Clips ----
  getClips: (projectId: string) =>
    get<ClipCandidate[]>(`/projects/${projectId}/clips`),
  createManualClip: (projectId: string, startTime: number, endTime: number) =>
    post<{ clipId: string }>(`/projects/${projectId}/clips/manual`, { startTime, endTime }),
  selectClip: (projectId: string, clipId: string, selected: boolean) =>
    post<ClipCandidate>(`/projects/${projectId}/clips/${clipId}/select`, { selected }),
  getSubtitles: (projectId: string, clipId: string) =>
    get<SubtitleSegment[]>(`/projects/${projectId}/clips/${clipId}/subtitles`),
  // ---- Analysis ----
  analyze: (projectId: string) =>
    post<AnalyzeResponse>(`/projects/${projectId}/analyze`, {}),
  createExportJob: (
    projectId: string,
    body: {
      clipId: string;
      trimStart: number;
      trimEnd: number;
      subtitles?: SubtitleSegment[] | { text: string; startTime: number; endTime: number }[];
      preset?: string;
      musicUrl?: string;
      musicVolume?: number;
      speed?: 0.5 | 1 | 2;
      textOverlay?: { text: string; position: 'top' | 'center' | 'bottom' } | null;
    },
  ) => post<AnalyzeResponse>(`/projects/${projectId}/export`, body),
  getExportJob: (projectId: string, jobId: string) =>
    get<JobProgress>(`/projects/${projectId}/export/${jobId}`),
  getExports: () => get<ExportItem[]>('/exports'),

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
  let active = true;
  let failures = 0;
  const MAX_FAILURES = 3;

  const poll = async () => {
    if (!active) return;
    try {
      const data = await get<JobProgress>(`/jobs/${jobId}`);
      if (!active) return;
      failures = 0;
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

  const intervalId = setInterval(poll, 2000);
  void poll();

  return () => {
    active = false;
    clearInterval(intervalId);
  };
}
