import { describe, expect, it } from 'vitest';
import { getMissingRequiredEnvVars } from './env';

describe('getMissingRequiredEnvVars', () => {
  it('does not require provider API keys for worker startup', () => {
    const missing = getMissingRequiredEnvVars({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      REDIS_HOST: 'redis',
    });

    expect(missing).toEqual([]);
  });

  it('requires core backend dependencies', () => {
    const missing = getMissingRequiredEnvVars({});

    expect(missing).toEqual(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'REDIS_HOST']);
  });
});
