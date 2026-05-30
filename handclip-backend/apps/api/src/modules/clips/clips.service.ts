import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { ClipCandidate } from '@handclip/shared';

export interface Clip extends ClipCandidate {
  projectId: string;
  selected: boolean;
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
      .update({ selected })
      .eq('id', clipId)
      .eq('project_id', projectId)
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return data as Clip;
  }
}
