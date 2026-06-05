import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { ProjectsService } from '../projects/projects.service';

export interface Export {
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
}
export interface UserExport {
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
}

@Injectable()
export class ExportsService {
  constructor(
    private supabaseService: SupabaseService,
    private projectsService: ProjectsService,
  ) {}

  async findByProject(projectId: string, userId: string): Promise<Export[]> {
    await this.projectsService.assertOwnedBy(projectId, userId);
    const client = this.supabaseService.getServiceRoleClient();
    const { data, error } = await client
      .from('exports')
      .select(
        'id, project_id, clip_id, preset, status, output_url, file_size, duration, created_at, completed_at',
      )
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return data ?? [];
  }

  async findOne(id: string, userId: string): Promise<Export | null> {
    const client = this.supabaseService.getServiceRoleClient();
    const { data, error } = await client
      .from('exports')
      .select(
        'id, project_id, clip_id, preset, status, output_url, file_size, duration, created_at, completed_at',
      )
      .eq('id', id)
      .single();

    if (error) {
      return null;
    }

    if (!data) {
      return null;
    }
    await this.projectsService.assertOwnedBy(data.project_id, userId);
    return data;
  }

  async findCompletedByUser(userId: string): Promise<UserExport[]> {
    const client = this.supabaseService.getServiceRoleClient();
    const { data, error } = await client
      .from('exports')
      .select(
        'id, project_id, clip_id, preset, status, output_url, file_size, duration, created_at, completed_at, projects:title',
      )
      .eq('status', 'completed')
      .eq('projects.user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      throw error;
    }
    return (data ?? []).map((exportRecord): UserExport => ({
      id: exportRecord.id,
      project_id: exportRecord.project_id,
      clip_id: exportRecord.clip_id,
      preset: exportRecord.preset,
      status: exportRecord.status,
      output_url: exportRecord.output_url,
      file_size: exportRecord.file_size,
      duration: exportRecord.duration,
      created_at: exportRecord.created_at,
      completed_at: exportRecord.completed_at,
      project_title: exportRecord.projects?.title || 'Proyecto sin nombre',
    }));
  }
}
