import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { ClipCandidate } from '@handclip/shared';

export interface Clip extends ClipCandidate {
  projectId: string;
  status: 'candidate' | 'selected' | 'edited' | 'exported';
  createdAt: string;
}

@Injectable()
export class ClipsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async findByProject(projectId: string): Promise<Clip[]> {
    const client = this.supabaseService.getClient();

    const { data, error } = await client
      .from('clips')
      .select('*')
      .eq('project_id', projectId)
      .order('confidence_score', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data || []) as Clip[];
  }

  async selectClip(projectId: string, clipId: string, selected: boolean): Promise<Clip> {
    const client = this.supabaseService.getClient();

    const { data, error } = await client
      .from('clips')
      .update({ status: selected ? 'selected' : 'candidate' })
      .eq('id', clipId)
      .eq('project_id', projectId)
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return data as Clip;
  }

  async createManualClip(projectId: string, startTime: number, endTime: number): Promise<{ clipId: string }> {
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

    if (error) throw new Error(error.message);
    return { clipId: data.id };
  }
}
