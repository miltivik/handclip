import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { ClipCandidate } from '@handclip/shared';

export interface Clip extends ClipCandidate {
  projectId: string;
  status: 'candidate' | 'selected' | 'edited' | 'exported';
  createdAt: string;
}

interface ClipRow {
  id: string;
  project_id: string;
  start_time: number;
  end_time: number;
  duration: number | null;
  confidence_score: number;
  reasons: string[];
  suggested_caption: string;
  transcript_snippet: string | null;
  mood_tags: string[] | null;
  platform_targets: string[] | null;
  status: string;
  user_edited: boolean;
  created_at: string;
}

function mapClip(row: ClipRow): Clip {
  return {
    id: row.id,
    projectId: row.project_id,
    startTime: row.start_time,
    endTime: row.end_time,
    duration: row.duration ?? undefined,
    confidenceScore: row.confidence_score,
    reasons: row.reasons ?? [],
    suggestedCaption: row.suggested_caption ?? '',
    transcriptSnippet: row.transcript_snippet ?? undefined,
    moodTags: row.mood_tags ?? undefined,
    platformTargets: row.platform_targets ?? undefined,
    status: row.status as Clip['status'],
    createdAt: row.created_at,
  };
}

@Injectable()
export class ClipsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private async verifyProjectOwnership(projectId: string, userId: string): Promise<void> {
    const client = this.supabaseService.getClient();
    const { data, error } = await client
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', userId)
      .single();
    if (error || !data) {
      throw new Error('Project not found');
    }
  }

  async findByProject(projectId: string, userId: string): Promise<Clip[]> {
    await this.verifyProjectOwnership(projectId, userId);
    const client = this.supabaseService.getClient();

    const { data, error } = await client
      .from('clips')
      .select('*')
      .eq('project_id', projectId)
      .order('confidence_score', { ascending: false });

    if (error) {
      console.error('Failed to fetch clips:', error);
      throw new Error('Failed to fetch clips');
    }

    return (data || []).map((row) => mapClip(row as ClipRow));
  }

  async selectClip(projectId: string, userId: string, clipId: string, selected: boolean): Promise<Clip> {
    await this.verifyProjectOwnership(projectId, userId);
    const client = this.supabaseService.getClient();

    const { data, error } = await client
      .from('clips')
      .update({ status: selected ? 'selected' : 'candidate' })
      .eq('id', clipId)
      .eq('project_id', projectId)
      .select()
      .single();
    if (error) {
      console.error('Failed to update clip:', error);
      throw new Error('Failed to update clip');
    }

    return mapClip(data as ClipRow);
  }

  async createManualClip(projectId: string, userId: string, startTime: number, endTime: number): Promise<{ clipId: string }> {
    await this.verifyProjectOwnership(projectId, userId);
    const client = this.supabaseService.getClient();

    const { data, error } = await client
      .from('clips')
      .insert({
        project_id: projectId,
        start_time: startTime,
        end_time: endTime,
        duration: endTime - startTime,
        confidence_score: 0,
        reasons: ['manual_selection'],
        suggested_caption: '',
        status: 'candidate',
      })
      .select('id')
      .single();
    if (error) {
      console.error('Failed to create clip:', error);
      throw new Error('Failed to create clip');
    }
    return { clipId: data.id };
  }
}
