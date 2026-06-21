import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Atomically increments the user's monthly export count and checks the limit.
 * Uses a Postgres function (`increment_export_count`) with `FOR UPDATE` lock
 * to prevent race conditions between concurrent renders.
 *
 * The function handles month reset internally.
 */
export async function incrementExportCount(
  userId: string,
  supabase: SupabaseClient,
): Promise<{ allowed: boolean; count: number }> {
  const { data, error } = await supabase.rpc('increment_export_count', {
    user_id: userId,
  });

  if (error) {
    console.error('[ExportCounter] RPC failed, denying export:', error.message);
    return { allowed: false, count: 0 };
  }

  // RPC returns [{ allowed: boolean, count: integer }]
  const result = data as unknown as { allowed: boolean; count: number };
  return { allowed: result.allowed, count: result.count };
}

/**
 * Refund one export slot for a user. Called by the render processor when
 * the increment was successful but the render failed before producing a
 * deliverable (network, FFmpeg error, etc). Without this, a free-tier user
 * loses 1 export per failed render.
 */
export async function decrementExportCount(
  userId: string,
  supabase: SupabaseClient,
): Promise<void> {
  const { error } = await supabase.rpc('decrement_export_count', {
    user_id: userId,
  });
  if (error) {
    console.error('[ExportCounter] Rollback RPC failed:', error.message);
  }
}
