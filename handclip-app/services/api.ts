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

export interface AudioUploadResponse {
  storagePath: string;
}

export interface JobProgress {
  jobId: string;
  type?: 'transcription' | 'clip_analysis' | 'render' | 'edit_prompt';
  status: 'QUEUED' | 'ACTIVE' | 'Completed' | 'Failed' | 'COMPLETED' | 'FAILED';
  progress: number;
  returnvalue?: Record<string, unknown>;
  failedReason?: string;
  result?: Record<string, unknown>;
  clientRequestId?: string;
  projectId?: string;
  updatedAt?: string;
}

export interface ActiveJob {
  jobId: string;
  projectId: string;
  type: 'transcription' | 'clip_analysis' | 'render' | 'edit_prompt';
  status: 'QUEUED' | 'ACTIVE' | 'COMPLETED' | 'FAILED';
  progress: number;
  result?: Record<string, unknown>;
  failedReason?: string;
  updatedAt: string;
  clientRequestId?: string;
}

export type AiOAuthProvider = 'openai-codex' | 'anthropic';
export type ApiKeyProvider =
  | 'openai'
  | 'anthropic'
  | 'openrouter'
  | 'deepseek'
  | 'google'
  | 'mistral'
  | 'groq'
  | 'xai'
  | 'minimax'
  | 'zai'
  | 'minimax-token-plan'
  | 'zai-coding-plan'
  | 'custom';
export type AiProvider = AiOAuthProvider | ApiKeyProvider;
export type AiConnectionType = 'oauth' | 'api-key' | 'openai-compatible';
export type PlanType = 'standard' | 'token-plan' | 'coding-plan' | 'oauth' | 'custom';
export type ModelListStrategy = 'static' | 'api' | 'openai-compatible-models';

export interface ModelInfo {
  id: string;
  label: string;
  recommended?: boolean;
}

export interface AiConnection {
  provider: AiProvider;
  connectionType: AiConnectionType;
  model: string | null;
  baseUrl: string | null;
  isActive: boolean;
  connectedAt: string;
}

export interface AiProviderField {
  name: string;
  label: string;
  required: boolean;
  secret?: boolean;
  placeholder?: string;
  helperText?: string;
}

export interface AiProviderCatalogEntry {
  id: AiProvider;
  displayName: string;
  group: 'subscription' | 'key-plan' | 'api-key' | 'custom';
  connectionType: AiConnectionType;
  description: string;
  warning?: string;
  defaultModel?: string;
  defaultBaseUrl?: string;
  modelRequired: boolean;
  baseUrlRequired: boolean;
  apiKeyRequired: boolean;
  fields: AiProviderField[];
  comingSoon?: boolean;
  supportedByPiAi: boolean;
  apiKeyUrl?: string;
  docsUrl?: string;
  modelsUrl?: string;
  planLabel?: string;
  planType?: PlanType;
  modelListStrategy?: ModelListStrategy;
  staticModels?: ModelInfo[];
}

export interface ValidateResponse {
  ok: true;
  provider: string;
  connectionType: string;
  models: ModelInfo[];
  defaultModel?: string;
}


export interface OAuthAttempt {
  id: string;
  provider: AiOAuthProvider;
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
  maxExports: number | null;
  plan: string;
  isUnlimited: boolean;
}

export interface BillingCheckout {
  id: string;
  url: string;
}
// =============================================================================
// Core HTTP helpers
// =============================================================================

// =============================================================================
// Core HTTP helpers
// =============================================================================

export class ApiHttpError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  constructor(method: string, path: string, status: number, message?: string) {
    super(message ?? `${method} ${path} → ${status}`);
    this.name = 'ApiHttpError';
    this.status = status;
    this.method = method;
    this.path = path;
  }
}

async function get<T>(path: string): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    },
  });
  if (!res.ok) throw new ApiHttpError('GET', path, res.status);
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
  if (!res.ok) throw new ApiHttpError('POST', path, res.status);
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
  if (!res.ok) throw new ApiHttpError('PATCH', path, res.status);
  return res.json() as Promise<T>;
}

async function del<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(await authHeaders()),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new ApiHttpError('DELETE', path, res.status);
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
  createBillingCheckout: () => post<BillingCheckout>('/billing/checkout', {}),

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
  analyze: (projectId: string, clientRequestId?: string) =>
    post<AnalyzeResponse>(`/projects/${projectId}/analyze`, { clientRequestId }),
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
      clientRequestId?: string;
    },
  ) => post<AnalyzeResponse>(`/projects/${projectId}/export`, body),
  submitEditPrompt: (
    projectId: string,
    body: { prompt: string; clientRequestId?: string },
  ) => post<AnalyzeResponse>(`/projects/${projectId}/edit-prompt`, body),
  getExportJob: (projectId: string, jobId: string) =>
    get<JobProgress>(`/projects/${projectId}/export/${jobId}`),
  getExports: () => get<ExportItem[]>('/exports'),

  // ---- Job continuity ----
  getJob: (jobId: string) => get<JobProgress>(`/jobs/${jobId}`),
  getActiveJobs: () => get<ActiveJob[]>('/jobs/active'),
  getLatestJobForProject: (projectId: string, type?: string) => {
    const qs = type ? `?type=${encodeURIComponent(type)}` : '';
    return get<JobProgress | null>(`/projects/${projectId}/jobs/latest${qs}`);
  },

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
  uploadAudio: async (file: { uri: string; fileName?: string; mimeType?: string; fileSize?: number }): Promise<AudioUploadResponse> => {
    const name = file.fileName ?? 'audio.mp3';
    const type = file.mimeType ?? 'audio/mpeg';
    const form = new FormData();
    form.append('audio', {
      uri: file.uri,
      name,
      type,
    } as unknown as Blob);
    return post<AudioUploadResponse>('/uploads/audio', form, true);
  },

  uploadAudioFile: async (file: { uri: string; fileName?: string; mimeType?: string; fileSize?: number }): Promise<{ audioUrl: string }> => {
    const { storagePath } = await api.uploadAudio(file);
    return { audioUrl: storagePath };
  },
  // ---- Health ----
  checkHealth: () =>
    get<{ status: string; timestamp: string; checks: Record<string, string> }>('/health'),

  // ---- AI provider connections ----
  getAiProviders: () => get<AiProviderCatalogEntry[]>('/ai-connections/providers'),
  getAiConnections: () => get<AiConnection[]>('/ai-connections'),
  startAiConnection: (provider: AiOAuthProvider) =>
    post<OAuthAttempt>(`/ai-connections/${provider}/start`, {}),
  getAiConnectionAttempt: (provider: AiOAuthProvider, id: string) =>
    get<OAuthAttempt>(`/ai-connections/${provider}/attempts/${id}`),
  submitAiConnectionInput: (provider: AiOAuthProvider, id: string, input: string) =>
    post<OAuthAttempt>(`/ai-connections/${provider}/attempts/${id}/input`, { input }),
  connectApiKey: (provider: ApiKeyProvider, body: { apiKey: string; model: string }) =>
    post<{ ok: true }>(`/ai-connections/${provider}/api-key`, body),
  connectOpenAiCompatible: (
    provider: 'custom' | 'zai-coding-plan',
    body: { apiKey: string; model: string; baseUrl: string },
  ) => post<{ ok: true }>(`/ai-connections/${provider}/openai-compatible`, body),
  validateApiKey: (
    provider: AiProvider,
    body: { connectionType: 'api-key' | 'openai-compatible'; apiKey: string; baseUrl?: string },
  ) => post<ValidateResponse>(`/ai-connections/${provider}/validate`, body),
  setActiveAiConnection: (provider: AiProvider, connectionType: AiConnectionType) =>
    patch<{ active: { provider: AiProvider; connectionType: AiConnectionType } }>(
      '/ai-connections/active',
      { provider, connectionType },
    ),
  disconnectAiConnection: (provider: AiProvider, connectionType: AiConnectionType) => {
    const qs = `?connectionType=${encodeURIComponent(connectionType)}`;
    return del<{ disconnected: { provider: AiProvider; connectionType: AiConnectionType } }>(
      `/ai-connections/${provider}${qs}`,
    );
  },

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
// Job progress poller (resilient, survives offline)
// =============================================================================

export type PollerStatus = 'active' | 'offline';

export interface PollerCallbacks {
  onProgress: (data: JobProgress, status: PollerStatus) => void;
  onComplete: (result?: Record<string, unknown>) => void;
  onError?: (error: Error) => void;
}

/**
 * Polls a job's status with exponential backoff. Network errors do NOT terminate
 * the poll — instead the caller is told the poller is "offline" and the job
 * stays in the persisted pending-jobs list until the next successful poll.
 * Only an explicit FAILED status from the server calls onError.
 */
export function subscribeJobProgress(
  jobId: string,
  onProgress: ((data: JobProgress) => void) | PollerCallbacks,
  onComplete?: (result?: Record<string, unknown>) => void,
  onError?: (error: Error) => void,
): () => void {
  // Normalize the two supported call signatures.
  let cb: PollerCallbacks;
  if (typeof onProgress === 'function') {
    cb = {
      onProgress: (data, _status) => (onProgress as (d: JobProgress) => void)(data),
      onComplete: onComplete ?? (() => {}),
      onError,
    };
  } else {
    cb = onProgress as PollerCallbacks;
  }

  let active = true;
  let intervalMs = 2000;
  const MIN_INTERVAL = 2000;
  const MAX_INTERVAL = 30000;
  const onCompleteFinal = cb.onComplete;

  const finishComplete = (result?: Record<string, unknown>) => {
    if (!active) return;
    active = false;
    onCompleteFinal(result);
  };

  const poll = async () => {
    if (!active) return;
    try {
      const data = await get<JobProgress>(`/jobs/${jobId}`);
      if (!active) return;
      intervalMs = MIN_INTERVAL;
      cb.onProgress(data, 'active');

      if (data.status === 'COMPLETED') {
        finishComplete(data.result ?? data.returnvalue);
      } else if (data.status === 'FAILED') {
        active = false;
        cb.onError?.(new Error(data.failedReason ?? 'Processing failed'));
      }
    } catch (err: any) {
      if (!active) return;
      // 404/403: the job is gone or not owned by this user (e.g. the
      // user signed out and back in as a different account, or the job
      // was deleted). Stop polling — retrying will not change the answer.
      if (err instanceof ApiHttpError && (err.status === 404 || err.status === 403)) {
        active = false;
        cb.onError?.(new Error('Trabajo no encontrado o sin acceso'));
        return;
      }
      // Server unreachable. Slow down, but keep polling — server may still
      // be processing the job. Caller is responsible for surfacing this in UI.
      intervalMs = Math.min(MAX_INTERVAL, Math.round(intervalMs * 1.5));
      cb.onProgress(
        { jobId, status: 'QUEUED', progress: 0 },
        'offline',
      );
    }
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (!active) return;
    timer = setTimeout(async () => {
      await poll();
      schedule();
    }, intervalMs);
  };

  void poll();
  schedule();

  return () => {
    active = false;
    if (timer) clearTimeout(timer);
  };
}
