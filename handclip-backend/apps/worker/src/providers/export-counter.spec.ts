import { describe, expect, it, vi } from 'vitest';
import { incrementExportCount } from './export-counter';

function buildSupabaseMock(profile: Record<string, unknown> | null) {
  const update = vi.fn().mockReturnThis();
  const eqUpdate = vi.fn().mockResolvedValue({ error: null });
  const single = vi.fn().mockResolvedValue({ data: profile, error: null });
  const eqSelect = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq: eqSelect });
  const from = vi.fn((table: string) => {
    if (table !== 'profiles') {
      throw new Error(`Unexpected table: ${table}`);
    }
    return {
      select,
      update,
      eq: eqUpdate,
    };
  });

  return {
    client: { from },
    update,
  };
}

describe('incrementExportCount', () => {
  it('does not limit or increment admin profiles', async () => {
    const { client, update } = buildSupabaseMock({
      exports_this_month: 9,
      plan: 'free',
      is_admin: true,
      last_export_reset_at: new Date().toISOString(),
    });

    await expect(incrementExportCount('admin-user', client as any)).resolves.toEqual({
      allowed: true,
      count: 9,
      limit: null,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('does not limit or increment pro profiles', async () => {
    const { client, update } = buildSupabaseMock({
      exports_this_month: 4,
      plan: 'pro',
      is_admin: false,
      last_export_reset_at: new Date().toISOString(),
    });

    await expect(incrementExportCount('pro-user', client as any)).resolves.toEqual({
      allowed: true,
      count: 4,
      limit: null,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('increments and limits free profiles', async () => {
    const { client, update } = buildSupabaseMock({
      exports_this_month: 3,
      plan: 'free',
      is_admin: false,
      last_export_reset_at: new Date().toISOString(),
    });

    await expect(incrementExportCount('free-user', client as any)).resolves.toEqual({
      allowed: false,
      count: 4,
      limit: 3,
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ exports_this_month: 4 }),
    );
  });
});
