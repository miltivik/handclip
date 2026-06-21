import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { SupabaseService } from '../supabase/supabase.service';
import { ALLOWED_VIDEO_MIMETYPES, MAX_VIDEO_SIZE_BYTES, MAX_VIDEO_SIZE_MB } from '@handclip/shared';

export interface Project {
  id: string;
  name: string;
  title: string;
  description?: string;
  userId: string;
  sourceVideoUrl?: string;
  sourceDuration?: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

// DB row shape (snake_case) → Project interface (camelCase)
function mapProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: (row.title ?? row.name) as string,
    title: (row.title ?? row.name) as string,
    description: row.description as string | undefined,
    userId: row.user_id as string,
    sourceVideoUrl: row.source_video_url as string | undefined,
    sourceDuration: row.source_duration as number | undefined,
    status: row.status as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}


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
    const client = this.supabaseService.getClient();

    const { data, error } = await client
      .from('projects')
      .insert({
        title: params.name,
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
    if (error) {
      console.error('Failed to save project:', error);
      throw new Error('Failed to save project');
    }

    return mapProject(data as Record<string, unknown>);
  }

  async findAll(userId: string): Promise<Project[]> {
    const client = this.supabaseService.getClient();

    const { data, error } = await client
      .from('projects')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('Failed to fetch projects:', error);
      throw new Error('Failed to fetch projects');
    }

    return (data || []).map((row) => mapProject(row as Record<string, unknown>));
  }

  async findOne(id: string, userId: string): Promise<Project> {
    const client = this.supabaseService.getClient();

    const { data, error } = await client
      .from('projects')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    if (error) {
      console.error('Failed to retrieve project:', error);
      throw new Error('Failed to retrieve project');
    }

    return mapProject(data as Record<string, unknown>);
  }

  async remove(id: string, userId: string): Promise<void> {
    const client = this.supabaseService.getClient();

    const { error } = await client
      .from('projects')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    if (error) {
      console.error('Failed to delete project:', error);
      throw new Error('Failed to delete project');
    }
  }

  async uploadVideo(
    file: Express.Multer.File,
    userId: string,
    projectId: string,
  ): Promise<{ videoUrl: string }> {
    // Validar formato
    if (!ALLOWED_VIDEO_MIMETYPES.includes(file.mimetype)) {
      throw new Error(
        `Formato no soportado. Usa MP4, MOV, WEBM, M4V o MKV. Recibido: ${file.mimetype}`,
      );
    }

    // Validar tamaño
    if (file.size > MAX_VIDEO_SIZE_BYTES) {
      throw new Error(
        `El video excede el tamaño máximo de ${MAX_VIDEO_SIZE_MB} MB. Tamaño recibido: ${(file.size / (1024 * 1024)).toFixed(2)} MB`,
      );
    }

    const client = this.supabaseService.getClient();

    // Determinar extensión del archivo
    const extension = this.getExtensionFromMimeType(file.mimetype);
    const storagePath = `${userId}/${projectId}/input.${extension}`;

    // Subir a Supabase Storage
    const { data, error } = await client.storage
      .from('source-videos')
      .upload(storagePath, readFileSync(file.path), {
        contentType: file.mimetype,
        upsert: false,
      });

    if (error) {
      console.error('Error al subir el video:', error);
      throw new Error('Error al subir el video');
    }

    // Obtener URL pública
    const { data: urlData } = client.storage
      .from('source-videos')
      .getPublicUrl(storagePath);

    return { videoUrl: urlData.publicUrl };
  }

  async getSignedVideoUrl(projectId: string, userId: string): Promise<string> {
    const client = this.supabaseService.getClient();

    // Obtener info del proyecto para construir la ruta
    const project = await this.findOne(projectId, userId);
    const extension = 'mp4'; // extensión por defecto, se puede mejorar
    const storagePath = `${project.userId || userId}/${projectId}/input.${extension}`;

    const { data, error } = await client.storage
      .from('source-videos')
      .createSignedUrl(storagePath, 3600); // 1 hora

    if (error) {
      console.error('Error al generar URL firmada:', error);
      throw new Error('Error al generar URL firmada');
    }

    if (!data.signedUrl) {
      throw new Error('No se pudo generar la URL firmada');
    }

    return data.signedUrl;
  }

  async uploadAndCreateProject(
    file: Express.Multer.File,
    name: string,
    userId: string,
  ): Promise<{ projectId: string; videoUrl: string }> {
    // Crear proyecto primero para obtener el ID
    const project = await this.create(userId, { name });

    // Subir video
    const { videoUrl } = await this.uploadVideo(file, userId, project.id);

    return { projectId: project.id, videoUrl };
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

  async getVideoUrl(projectId: string, userId: string): Promise<string> {
    const project = await this.findOne(projectId, userId);
    if (!project.sourceVideoUrl) {
      throw new Error('Video no encontrado para este proyecto');
    }
    return this.getSignedVideoUrl(projectId, userId);
  }
}
