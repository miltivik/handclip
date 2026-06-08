import { SupabaseClient } from '@supabase/supabase-js';
import { getMonthlyExportLimit } from '@handclip/shared/constants/limits';

export async function incrementExportCount(
  userId: string,
  supabase: SupabaseClient,
): Promise<{ allowed: boolean; count: number; limit: number | null }> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('exports_this_month, plan, is_admin, last_export_reset_at')
    .eq('id', userId)
    .single();

  const limit = getMonthlyExportLimit(profile?.plan, Boolean(profile?.is_admin));
  if (limit === null) {
    return { allowed: true, count: profile?.exports_this_month || 0, limit };
  }

  const now = new Date();
  const lastReset = profile?.last_export_reset_at ? new Date(profile.last_export_reset_at) : null;
  const needsReset = !lastReset || lastReset.getMonth() !== now.getMonth() || lastReset.getFullYear() !== now.getFullYear();

  const count = needsReset ? 1 : (profile?.exports_this_month || 0) + 1;

  await supabase
    .from('profiles')
    .update({ exports_this_month: count, last_export_reset_at: now.toISOString() })
    .eq('id', userId);

  return { allowed: count <= limit, count, limit };
}
