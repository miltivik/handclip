import { Injectable } from '@nestjs/common';
import { ClipCandidate, SubtitleSegment } from '@handclip/shared';
import { SupabaseService } from '../supabase/supabase.service';
import { ProjectsService } from '../projects/projects.service';

export interface Clip extends ClipCandidate {
  projectId: string;
  status: 'candidate' | 'selected' | 'edited' | 'exported';
  createdAt: string;
}

@Injectable()
export class ClipsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly projectsService: ProjectsService,
  ) {}

  async findByProject(projectId: string, userId: string): Promise<Clip[]> {
    await this.projectsService.assertOwnedBy(projectId, userId);
    const { data, error } = await this.supabaseService
      .getServiceRoleClient()
      .from('clips')
      .select('*')
      .eq('project_id', projectId)
      .order('confidence_score', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data || []).map((row) => this.mapClip(row));
  }

  async selectClip(
    projectId: string,
    clipId: string,
    selected: boolean,
    userId: string,
  ): Promise<Clip> {
    await this.projectsService.assertOwnedBy(projectId, userId);
    const { data, error } = await this.supabaseService
      .getServiceRoleClient()
      .from('clips')
      .update({ status: selected ? 'selected' : 'candidate' })
      .eq('id', clipId)
      .eq('project_id', projectId)
      .select()
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Clip not found');
    }

    return this.mapClip(data);
  }

  async createManualClip(
    projectId: string,
    startTime: number,
    endTime: number,
    userId: string,
  ): Promise<{ clipId: string }> {
    await this.projectsService.assertOwnedBy(projectId, userId);
    const { data, error } = await this.supabaseService
      .getServiceRoleClient()
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

    if (error || !data) {
      throw new Error(error?.message || 'Failed to create clip');
    }
    return { clipId: data.id };
  }

  async getSubtitles(
    projectId: string,
    clipId: string,
    userId: string,
  ): Promise<SubtitleSegment[]> {
    await this.projectsService.assertOwnedBy(projectId, userId);
    const { data, error } = await this.supabaseService
      .getServiceRoleClient()
      .from('subtitles')
      .select('segments')
      .eq('project_id', projectId)
      .or(`clip_id.eq.${clipId},clip_id.is.null`);

    if (error) {
      throw new Error(error.message);
    }

    return (data || []).flatMap((row) => row.segments || []) as SubtitleSegment[];
  }

  private mapClip(row: any): Clip {
    return {
      id: row.id,
      projectId: row.project_id,
      startTime: row.start_time,
      endTime: row.end_time,
      duration: row.duration,
      confidenceScore: row.confidence_score,
      reasons: row.reasons || [],
      suggestedCaption: row.suggested_caption || '',
      transcriptSnippet: row.transcript_snippet || '',
      moodTags: row.mood_tags || [],
      platformTargets: row.platform_targets || [],
      status: row.status,
      createdAt: row.created_at,
    };
  }
}
