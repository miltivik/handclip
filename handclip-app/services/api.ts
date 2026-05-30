const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api';

// =============================================================================
// Types
// =============================================================================

export interface Project {
  id: string;
  name: string;
  description?: string;
  userId: string;
  status?: string;
  sourceVideoUrl?: string;
  duration?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClipCandidate {
  id: string;
  startTime: number;
  endTime: number;
  duration?: number;
  confidenceScore: number;
  reasons: string[];
  suggestedCaption: string;
  transcriptSnippet?: string;
  moodTags?: string[];
  platformTargets?: string[];
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
  jobId: string;
}

export interface UploadResponse {
  projectId: string;
  videoUrl: string;
}

export interface JobProgress {
  jobId: string;
  type: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  progress: number;
  result?: {
    clips?: ClipCandidate[];
    outputUrl?: string;
  };
}

// =============================================================================
// Core HTTP helpers
// =============================================================================

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function post<T>(path: string, body: Record<string, unknown> | FormData, multipart = false): Promise<T> {
  const bodyInit: BodyInit = multipart ? (body as FormData) : JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: multipart ? {} : { 'Content-Type': 'application/json' },
    body: bodyInit,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// =============================================================================
// Auth
// =============================================================================

export const api = {
  login: (email: string) =>
    post<{ token: string }>('/auth/login', { email }),

  verify: (token: string, email: string) =>
    post<{ userId: string }>('/auth/verify', { token, email }),

  // =============================================================================
  // Projects
  // =============================================================================

  createProject: (body: {
    name: string;
    sourceVideoUrl: string;
    duration?: number;
    width?: number;
    height?: number;
  }) =>
    post<{ projectId: string }>('/projects', body),

  uploadVideo: async (fileUri: string, fileName: string): Promise<UploadResponse> => {
    const formData = new FormData();
    formData.append('video', {
      uri: fileUri,
      name: fileName,
      type: 'video/mp4',
    } as unknown as Blob);
    formData.append('name', fileName.replace(/\.[^/.]+$/, ''));
    return post<UploadResponse>('/projects/upload', formData, true);
  },

  getProject: (id: string) => get<Project>(`/projects/${id}`),

  getProjects: () => get<Project[]>('/projects'),

  // =============================================================================
  // Analysis
  // =============================================================================

  analyze: (projectId: string, videoUrl: string) =>
    post<AnalyzeResponse>(`/projects/${projectId}/analyze`, { videoUrl }),

  // =============================================================================
  // Jobs
  // =============================================================================

  getJob: (jobId: string) => get<JobProgress>(`/jobs/${jobId}`),

  // =============================================================================
  // Clips
  // =============================================================================

  getSubtitles: (projectId: string, clipId?: string) =>
    get<{ segments: SubtitleSegment[] }>(
      `/projects/${projectId}/subtitles${clipId ? `?clipId=${clipId}` : ''}`,
    ),

  getClips: (projectId: string) => get<ClipCandidate[]>(`/projects/${projectId}/clips`),

  selectClip: (projectId: string, clipId: string, selected: boolean) =>
    post(`/projects/${projectId}/clips/${clipId}/select`, { selected }),

  // ============================================================================
  // Export
  // ============================================================================

  exportClip: (
    projectId: string,
    body: {
      clipId: string;
      trimStart: number;
      trimEnd: number;
      subtitles: { id: string; text: string; startTime: number; endTime: number }[];
      musicUrl?: string;
      musicVolume?: number;
      musicFadeIn?: number;
      musicFadeOut?: number;
      preset: 'tiktok' | 'reels' | 'shorts' | 'draft' | 'hq';
    },
  ) => post<{ jobId: string }>(`/projects/${projectId}/export`, body),

  getExportJob: (projectId: string, jobId: string) =>
    get<JobProgress>(`/projects/${projectId}/export/${jobId}`),

  // ============================================================================
  // Chunked Upload
  // ============================================================================

  initUpload: (fileName: string, fileSize: number, mimeType: string) =>
    post<{ uploadId: string }>('/uploads/init', { fileName, fileSize, mimeType }),

  uploadChunk: (uploadId: string, chunkIndex: number, chunk: Blob) => {
    const formData = new FormData();
    formData.append('chunk', chunk);
    formData.append('chunkIndex', String(chunkIndex));
    return post<{ received: number; total: number }>(`/uploads/${uploadId}/chunk`, formData, true);
  },

  completeUpload: (uploadId: string) =>
    post<{ videoUrl: string }>(`/uploads/${uploadId}/complete`, {}),
  uploadVideoFile: async (file: {
    uri: string;
    fileName?: string;
    mimeType?: string;
    fileSize?: number;
  }): Promise<{ videoUrl: string }> => {
    const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

    // 1. Fetch file as ArrayBuffer
    const response = await fetch(file.uri);
    if (!response.ok) throw new Error('No se pudo leer el archivo');
    const arrayBuffer = await response.arrayBuffer();

    const fileSize = file.fileSize ?? arrayBuffer.byteLength;
    const fileName = file.fileName ?? `video_${Date.now()}.mp4`;
    const mimeType = file.mimeType ?? 'video/mp4';

    // 2. Init upload
    const { uploadId } = await api.initUpload(fileName, fileSize, mimeType);

    // 3. Split into chunks and upload sequentially
    const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileSize);
      const chunk = arrayBuffer.slice(start, end);
      await api.uploadChunk(uploadId, i, new Blob([chunk], { type: mimeType }));
    }

    // 4. Complete upload
    const { videoUrl } = await api.completeUpload(uploadId);
    return { videoUrl };
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
      onProgress(data);

      if (data.status === 'COMPLETED') {
        active = false;
        onComplete(data.result);
      } else if (data.status === 'FAILED') {
        active = false;
        onError?.(new Error('El procesamiento del video falló'));
      }
    } catch {
      failures++;
      if (failures >= MAX_FAILURES) {
        active = false;
        onError?.(new Error('No se pudo conectar con el servidor'));
      }
    }
  };

  // Poll cada 2 segundos
  const intervalId = setInterval(poll, 2000);
  // Primera llamada inmediata
  poll();

  return () => {
    active = false;
    clearInterval(intervalId);
  };
}
