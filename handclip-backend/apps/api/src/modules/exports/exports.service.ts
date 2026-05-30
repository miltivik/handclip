import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

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

@Injectable()
export class ExportsService {
  constructor(private supabaseService: SupabaseService) {}

  async findByProject(projectId: string): Promise<Export[]> {
    const client = this.supabaseService.getClient();
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

  async findOne(id: string): Promise<Export | null> {
    const client = this.supabaseService.getClient();
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

    return data;
  }
}
