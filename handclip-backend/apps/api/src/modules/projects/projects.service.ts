import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';

interface ProjectRow {
  id: string;
  title: string;
  description?: string | null;
  user_id: string;
  source_video_url?: string | null;
  source_duration?: number | null;
  status?: string;
  created_at: string;
  updated_at: string;
}

interface ProjectShareRow {
  id: string;
  project_id: string;
  created_by: string;
  token: string;
  revoked_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface ProjectShareLink {
  shareId: string;
  token: string;
  createdAt: string;
}

export interface PublicShareClip {
  id: string;
  startTime: number;
  endTime: number;
  duration: number;
  confidenceScore: number;
  suggestedCaption: string | null;
  transcriptSnippet: string | null;
  moodTags: string[];
  status: string;
}

export interface PublicShareView {
  projectId: string;
  title: string;
  createdAt: string;
  status: string;
  clips: PublicShareClip[];
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  userId: string;
  sourceVideoUrl?: string;
  sourceDuration?: number;
  status?: string;
  createdAt: string;
  updatedAt: string;
}

export const ALLOWED_VIDEO_MIMETYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
  'video/x-matroska',
];

export const MAX_VIDEO_SIZE_MB = 500;
export const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024;

@Injectable()
export class ProjectsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async create(
    userId: string,
    params: {
      name: string;
      description?: string;
      sourceVideoUrl?: string;
      duration?: number;
      width?: number;
      height?: number;
    },
  ): Promise<Project> {
    if (params.sourceVideoUrl && !params.sourceVideoUrl.startsWith(`${userId}/`)) {
      throw new BadRequestException('Video path must belong to authenticated user');
    }
    const { data, error } = await this.supabaseService
      .getServiceRoleClient()
      .from('projects')
      .insert({
        title: params.name,
        description: params.description || null,
        user_id: userId,
        source_video_url: params.sourceVideoUrl || null,
        source_duration: params.duration || null,
        metadata: params.width && params.height
          ? { width: params.width, height: params.height }
          : null,
        status: 'uploading',
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Failed to create project');
    }

    return this.mapProject(data as ProjectRow);
  }

  async findAll(userId: string): Promise<Project[]> {
    const { data, error } = await this.supabaseService
      .getServiceRoleClient()
      .from('projects')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data || []).map((row) => this.mapProject(row as ProjectRow));
  }

  async findOne(id: string, userId: string): Promise<Project> {
    const row = await this.assertOwnedBy(id, userId);
    const sourceVideoUrl = row.source_video_url
      ? await this.signStoragePath(row.source_video_url)
      : undefined;
    return this.mapProject(row, sourceVideoUrl);
  }

  async remove(id: string, userId: string): Promise<void> {
    const { error } = await this.supabaseService
      .getServiceRoleClient()
      .from('projects')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      throw new Error(error.message);
    }
  }

  async uploadVideo(
    file: Express.Multer.File,
    userId: string,
    projectId: string,
  ): Promise<{ storagePath: string; videoUrl: string }> {
    if (!ALLOWED_VIDEO_MIMETYPES.includes(file.mimetype)) {
      throw new Error(
        `Formato no soportado. Usa MP4, MOV, WEBM, M4V o MKV. Recibido: ${file.mimetype}`,
      );
    }

    if (file.size > MAX_VIDEO_SIZE_BYTES) {
      throw new Error(
        `El video excede el tamano maximo de ${MAX_VIDEO_SIZE_MB} MB. Tamano recibido: ${(file.size / (1024 * 1024)).toFixed(2)} MB`,
      );
    }

    const client = this.supabaseService.getServiceRoleClient();
    const extension = this.getExtensionFromMimeType(file.mimetype);
    const storagePath = `${userId}/${projectId}/input.${extension}`;
    const { error } = await client.storage
      .from('source-videos')
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (error) {
      throw new Error(`Error al subir el video: ${error.message}`);
    }

    return {
      storagePath,
      videoUrl: await this.signStoragePath(storagePath),
    };
  }

  async getSignedVideoUrl(projectId: string, userId: string): Promise<string> {
    const project = await this.assertOwnedBy(projectId, userId);
    if (!project.source_video_url) {
      throw new Error('Video no encontrado para este proyecto');
    }
    if (!project.source_video_url.startsWith(`${userId}/`)) {
      throw new NotFoundException('Video not found');
    }
    return this.signStoragePath(project.source_video_url);
  }

  async uploadAndCreateProject(
    file: Express.Multer.File,
    name: string,
    userId: string,
  ): Promise<{ projectId: string; videoUrl: string }> {
    const project = await this.create(userId, { name });
    const { storagePath, videoUrl } = await this.uploadVideo(file, userId, project.id);
    const { error } = await this.supabaseService
      .getServiceRoleClient()
      .from('projects')
      .update({
        source_video_url: storagePath,
        status: 'uploaded',
        updated_at: new Date().toISOString(),
      })
      .eq('id', project.id)
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Error al guardar la ruta del video: ${error.message}`);
    }

    return { projectId: project.id, videoUrl };
  }

  async getVideoUrl(projectId: string, userId: string): Promise<string> {
    return this.getSignedVideoUrl(projectId, userId);
  }

  /**
   * Returns the storage path (e.g. "userId/projectId/input.mp4") of the
   * project's source video. The path is the canonical reference: it is
   * safe to pass through queue payloads and survives long-running jobs
   * (no 1h signed-URL expiry). Use `signStoragePath` at download time.
   */
  async getSourceVideoPath(projectId: string, userId: string): Promise<string> {
    const project = await this.assertOwnedBy(projectId, userId);
    if (!project.source_video_url) {
      throw new NotFoundException('Video not found for this project');
    }
    if (!project.source_video_url.startsWith(`${userId}/`)) {
      throw new NotFoundException('Video not found');
    }
    return project.source_video_url;
  }

  async assertOwnedBy(projectId: string, userId: string): Promise<ProjectRow> {
    const { data, error } = await this.supabaseService
      .getServiceRoleClient()
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('user_id', userId)
      .single();
    if (error || !data) {
      throw new NotFoundException('Project not found');
    }
    return data as ProjectRow;
  }

  // ---------------------------------------------------------------------------
  // Share links (collaboration)
  // ---------------------------------------------------------------------------

  /** Max active (non-revoked, non-expired) links per project. */
  private static readonly MAX_ACTIVE_SHARES_PER_PROJECT = 10;

  async createShareLink(projectId: string, userId: string): Promise<ProjectShareLink> {
    await this.assertOwnedBy(projectId, userId);
    const client = this.supabaseService.getServiceRoleClient();

    const { count, error: countError } = await client
      .from('project_shares')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .is('revoked_at', null);
    if (countError) {
      throw new Error(`Error al contar enlaces: ${countError.message}`);
    }
    if ((count ?? 0) >= ProjectsService.MAX_ACTIVE_SHARES_PER_PROJECT) {
      throw new BadRequestException(
        `Este proyecto ya tiene ${count} enlaces activos. Revoca alguno antes de crear otro.`,
      );
    }

    const { data, error } = await client
      .from('project_shares')
      .insert({
        project_id: projectId,
        created_by: userId,
        token: randomBytes(24).toString('base64url'),
      })
      .select('id, token, created_at')
      .single();

    if (error || !data) {
      throw new Error(`Error al crear el enlace: ${error?.message}`);
    }
    return { shareId: data.id, token: data.token, createdAt: data.created_at };
  }

  async revokeShareLink(projectId: string, userId: string, shareId: string): Promise<void> {
    await this.assertOwnedBy(projectId, userId);
    const { error } = await this.supabaseService
      .getServiceRoleClient()
      .from('project_shares')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', shareId)
      .eq('project_id', projectId)
      .eq('created_by', userId)
      .is('revoked_at', null);
    if (error) {
      throw new Error(`Error al revocar el enlace: ${error.message}`);
    }
  }

  async listShareLinks(projectId: string, userId: string): Promise<ProjectShareLink[]> {
    await this.assertOwnedBy(projectId, userId);
    const { data, error } = await this.supabaseService
      .getServiceRoleClient()
      .from('project_shares')
      .select('id, token, created_at, revoked_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    if (error) {
      throw new Error(`Error al listar enlaces: ${error.message}`);
    }
    return ((data as ProjectShareRow[] | null) ?? [])
      .filter((row) => !row.revoked_at)
      .map((row) => ({ shareId: row.id, token: row.token, createdAt: row.created_at }));
  }

  /**
   * Resolves a share token into read-only viewer data. Returns null for
   * unknown, revoked or expired tokens. Never exposes the source video
   * URL or any owner-identifying field.
   */
  async getPublicShareView(token: string): Promise<PublicShareView | null> {
    if (!token || token.length > 128) {
      return null;
    }
    const client = this.supabaseService.getServiceRoleClient();

    const { data: shareRow, error: shareError } = await client
      .from('project_shares')
      .select('id, project_id, revoked_at, expires_at')
      .eq('token', token)
      .maybeSingle();
    if (shareError || !shareRow) {
      return null;
    }
    const share = shareRow as Pick<ProjectShareRow, 'id' | 'project_id' | 'revoked_at' | 'expires_at'>;
    if (share.revoked_at) {
      return null;
    }
    if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
      return null;
    }

    const { data: projectRow, error: projectError } = await client
      .from('projects')
      .select('id, title, status, created_at')
      .eq('id', share.project_id)
      .single();
    if (projectError || !projectRow) {
      return null;
    }

    const { data: clipRows, error: clipsError } = await client
      .from('clips')
      .select(
        'id, start_time, end_time, duration, confidence_score, suggested_caption, transcript_snippet, mood_tags, status',
      )
      .eq('project_id', share.project_id)
      .neq('status', 'deleted')
      .order('confidence_score', { ascending: false });
    if (clipsError) {
      throw new Error(`Error al cargar clips del enlace: ${clipsError.message}`);
    }

    return {
      projectId: projectRow.id,
      title: projectRow.title,
      createdAt: projectRow.created_at,
      status: projectRow.status ?? 'ready',
      clips: ((clipRows as any[] | null) ?? []).map((row) => ({
        id: row.id,
        startTime: Number(row.start_time) || 0,
        endTime: Number(row.end_time) || 0,
        duration: Number(row.duration) || 0,
        confidenceScore: Number(row.confidence_score) || 0,
        suggestedCaption: row.suggested_caption ?? null,
        transcriptSnippet: row.transcript_snippet ?? null,
        moodTags: Array.isArray(row.mood_tags) ? row.mood_tags : [],
        status: row.status ?? 'candidate',
      })),
    };
  }

  private async signStoragePath(storagePath: string): Promise<string> {
    const { data, error } = await this.supabaseService
      .getServiceRoleClient()
      .storage
      .from('source-videos')
      .createSignedUrl(storagePath, 3600);

    if (error || !data?.signedUrl) {
      throw new Error(`Error al generar URL firmada: ${error?.message || 'signed URL missing'}`);
    }

    return data.signedUrl;
  }

  private getExtensionFromMimeType(mimetype: string): string {
    const extensionMap: Record<string, string> = {
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
      'video/webm': 'webm',
      'video/x-m4v': 'm4v',
      'video/x-matroska': 'mkv',
    };
    return extensionMap[mimetype] || 'mp4';
  }

  private mapProject(row: ProjectRow, sourceVideoUrl = row.source_video_url || undefined): Project {
    return {
      id: row.id,
      name: row.title,
      description: row.description || undefined,
      userId: row.user_id,
      sourceVideoUrl,
      sourceDuration: row.source_duration || undefined,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
