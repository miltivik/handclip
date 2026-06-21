import { supabase } from './supabase';

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
  words: { word: string; start: number; end: number; probability: number }[];
  language: string;
  speaker?: string;
}

export interface AnalyzeResponse {
  jobId: string;
  message?: string;
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
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}


// =============================================================================
// API
// =============================================================================

export const api = {
  // ---- Projects ----
  getProjects: () => get<Project[]>('/projects'),

  getProject: (projectId: string) => get<Project>(`/projects/${projectId}`),

  // ---- Clips ----
  getClips: (projectId: string) =>
    get<ClipCandidate[]>(`/projects/${projectId}/clips`),

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
    clipId: string;
    trimStart: number;
    trimEnd: number;
    subtitles: SubtitleSegment[];
    preset: string;
  }) =>
    post<{ jobId: string; exportId: string }>(`/projects/${projectId}/export`, data),

  createManualClip: (projectId: string, startTime: number, endTime: number) =>
    post<{ id: string; startTime: number; endTime: number }>(
      `/projects/${projectId}/clips/manual`,
      { startTime, endTime },
    ),

  getExportJob: (exportId: string) =>
    get<{ status: string; progress: number; outputUrl?: string }>(`/exports/${exportId}/status`),

  getExports: (projectId: string) =>
    get<Array<{ id: string; status: string; outputUrl?: string; preset: string; createdAt: string }>>(`/projects/${projectId}/exports`),

  // ---- Uploads ----
  uploadVideoFile: async (uri: string, fileName: string): Promise<UploadResponse> => {
    const formData = new FormData();
    // React Native FormData accepts a file-like object at runtime but the
    // typed signature is Blob. Cast via unknown with a short reason.
    formData.append('video', { uri, name: fileName, type: 'video/mp4' } as unknown as Blob);
    formData.append('name', fileName);
    return post<UploadResponse>('/projects/upload', formData, true);
  },

  // ---- Health ----
  checkHealth: () =>
    get<{ status: string; timestamp: string; checks: Record<string, string> }>('/health'),
};
