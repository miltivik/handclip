import { SupabaseClient } from '@supabase/supabase-js';
import { MAX_FREE_EXPORTS_PER_MONTH } from '@handclip/shared/constants/limits';

export async function incrementExportCount(
  userId: string,
  supabase: SupabaseClient,
): Promise<{ allowed: boolean; count: number }> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('exports_this_month, last_export_reset_at')
    .eq('id', userId)
    .single();

  const now = new Date();
  const lastReset = profile?.last_export_reset_at ? new Date(profile.last_export_reset_at) : null;
  const needsReset = !lastReset || lastReset.getMonth() !== now.getMonth() || lastReset.getFullYear() !== now.getFullYear();

  const count = needsReset ? 1 : (profile?.exports_this_month || 0) + 1;

  await supabase
    .from('profiles')
    .update({ exports_this_month: count, last_export_reset_at: now.toISOString() })
    .eq('id', userId);

  return { allowed: count <= MAX_FREE_EXPORTS_PER_MONTH, count };
}
