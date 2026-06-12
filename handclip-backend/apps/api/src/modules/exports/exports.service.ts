import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export interface Export {
  id: string;
  projectId: string;
  clipId: string | null;
  preset: string;
  status: string;
  outputUrl: string | null;
  fileSize: number | null;
  duration: number | null;
  createdAt: string;
  completedAt: string | null;
}

interface ExportRow {
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

function mapExport(row: ExportRow): Export {
  return {
    id: row.id,
    projectId: row.project_id,
    clipId: row.clip_id,
    preset: row.preset,
    status: row.status,
    outputUrl: row.output_url,
    fileSize: row.file_size,
    duration: row.duration,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? null,
  };
}

@Injectable()
export class ExportsService {
  constructor(private supabaseService: SupabaseService) {}

  async findByProject(projectId: string, token: string): Promise<Export[]> {
    const client = this.supabaseService.getClientWithAuth(token);
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

    return (data ?? []).map((row) => mapExport(row as ExportRow));
  }

  async findOne(id: string, token: string): Promise<Export | null> {
    const client = this.supabaseService.getClientWithAuth(token);
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

    return mapExport(data as ExportRow);
  }

  async getStatus(id: string, token: string): Promise<{
    status: string;
    progress: number;
    outputUrl: string | null;
    error?: string;
  } | null> {
    const exportRecord = await this.findOne(id, token);
    if (!exportRecord) return null;

    // If already completed or failed, return immediately
    if (exportRecord.status === 'completed' || exportRecord.status === 'failed') {
      return {
        status: exportRecord.status,
        progress: exportRecord.status === 'completed' ? 100 : 0,
        outputUrl: exportRecord.outputUrl,
      };
    }

    // Look up the associated render job for real-time progress
    const client = this.supabaseService.getClientWithAuth(token);
    const { data: jobRow } = await client
      .from('jobs')
      .select('status, progress, result')
      .eq('project_id', exportRecord.projectId)
      .eq('type', 'render')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    return {
      status: exportRecord.status,
      progress: jobRow?.progress ?? 0,
      outputUrl: exportRecord.outputUrl,
      error: jobRow?.result?.error,
    };
  }
}
