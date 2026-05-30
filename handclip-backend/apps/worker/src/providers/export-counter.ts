import { createClient } from '@supabase/supabase-js';

export async function incrementExportCount(userId: string): Promise<{ allowed: boolean; count: number }> {
  const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );

  const { data: profile } = await supabase
    .from('profiles')
    .select('exports_this_month, last_export_reset_at')
    .eq('id', userId)
    .single();

  const now = new Date();
  const lastReset = profile?.last_export_reset_at ? new Date(profile.last_export_reset_at) : null;
  const needsReset = !lastReset || lastReset.getMonth() !== now.getMonth() || lastReset.getFullYear() !== now.getFullYear();

  const count = needsReset ? 1 : (profile?.exports_this_month || 0) + 1;
  const MAX_FREE_EXPORTS = 3;

  await supabase
    .from('profiles')
    .update({ exports_this_month: count, last_export_reset_at: now.toISOString() })
    .eq('id', userId);

  return { allowed: count <= MAX_FREE_EXPORTS, count };
}