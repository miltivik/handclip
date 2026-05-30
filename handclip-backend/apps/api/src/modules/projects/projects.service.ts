import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export interface Project {
  id: string;
  name: string;
  description?: string;
  userId: string;
  sourceVideoUrl?: string;
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

  async create(name: string, description?: string): Promise<Project> {
    const client = this.supabaseService.getClient();
    const user = await this.getCurrentUser();

    const { data, error } = await client
      .from('projects')
      .insert({
        name,
        description,
        user_id: user?.id || 'anonymous',
      })
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return data as Project;
  }

  async findAll(): Promise<Project[]> {
    const client = this.supabaseService.getClient();
    const user = await this.getCurrentUser();

    const { data, error } = await client
      .from('projects')
      .select('*')
      .eq('user_id', user?.id || 'anonymous')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data || []) as Project[];
  }

  async findOne(id: string): Promise<Project> {
    const client = this.supabaseService.getClient();

    const { data, error } = await client
      .from('projects')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return data as Project;
  }

  async remove(id: string): Promise<void> {
    const client = this.supabaseService.getClient();

    const { error } = await client.from('projects').delete().eq('id', id);

    if (error) {
      throw new Error(error.message);
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
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (error) {
      throw new Error(`Error al subir el video: ${error.message}`);
    }

    // Obtener URL pública
    const { data: urlData } = client.storage
      .from('source-videos')
      .getPublicUrl(storagePath);

    return { videoUrl: urlData.publicUrl };
  }

  async getSignedVideoUrl(projectId: string): Promise<string> {
    const client = this.supabaseService.getClient();
    const user = await this.getCurrentUser();

    if (!user) {
      throw new Error('No se pudo identificar al usuario');
    }

    // Obtener info del proyecto para construir la ruta
    const project = await this.findOne(projectId);
    const extension = 'mp4'; // extensión por defecto, se puede mejorar
    const storagePath = `${project.userId || user.id}/${projectId}/input.${extension}`;

    const { data, error } = await client.storage
      .from('source-videos')
      .createSignedUrl(storagePath, 3600); // 1 hora

    if (error) {
      throw new Error(`Error al generar URL firmada: ${error.message}`);
    }

    if (!data.signedUrl) {
      throw new Error('No se pudo generar la URL firmada');
    }

    return data.signedUrl;
  }

  async uploadAndCreateProject(
    file: Express.Multer.File,
    name: string,
  ): Promise<{ projectId: string; videoUrl: string }> {
    const user = await this.getCurrentUser();
    const userId = user?.id || 'anonymous';

    // Crear proyecto primero para obtener el ID
    const project = await this.create(name);

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
  async getVideoUrl(projectId: string): Promise<string> {
    const project = await this.findOne(projectId);
    if (!project.sourceVideoUrl) {
      throw new Error('Video no encontrado para este proyecto');
    }
    return this.getSignedVideoUrl(projectId);
  }

  async getCurrentUser(): Promise<{ id: string } | null> {
    try {
      const client = this.supabaseService.getClient();
      const { data } = await client.auth.getUser();
      return data.user;
    } catch {
      return null;
    }
  }
}
