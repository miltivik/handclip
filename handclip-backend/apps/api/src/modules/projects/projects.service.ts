import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
