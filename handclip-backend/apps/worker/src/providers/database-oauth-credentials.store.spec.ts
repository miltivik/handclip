import { encryptJson, AiSubscriptionProvider } from '@handclip/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseOAuthCredentialsStore } from './database-oauth-credentials.store';

const KEY = Buffer.alloc(32, 5).toString('base64');

function buildSupabaseMock(rows: any[] = []) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: rows[0] ?? null, error: rows.length === 0 ? { code: 'PGRST116' } : null }),
  };
  return {
    from: vi.fn(() => chain),
    _chain: chain,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DatabaseOAuthCredentialsStore', () => {
  it('returns null when no active connection exists', async () => {
    const supabase = buildSupabaseMock([]);
    const store = new DatabaseOAuthCredentialsStore(
      supabase as any,
      KEY,
      async () => ({ loginOpenAICodexDeviceCode: vi.fn(), loginAnthropic: vi.fn() }) as any,
    );
    await expect(store.getActiveApiKey('missing-user')).resolves.toBeNull();
  });

  it('resolves Codex active connection and returns api key with refreshed credentials', async () => {
    const encrypted = encryptJson({ access: 'old', refresh: 'r', expires: 1 }, KEY);
    const supabase = buildSupabaseMock([
      {
        id: 'row-1',
        provider: 'openai-codex' as AiSubscriptionProvider,
        credentials_ciphertext: encrypted.credentialsCiphertext,
        credentials_iv: encrypted.credentialsIv,
        credentials_tag: encrypted.credentialsTag,
      },
    ]);
    const oauth = {
      getOAuthApiKey: vi.fn(async (_provider, credentials) => ({
        apiKey: 'token',
        newCredentials: { access: 'new', refresh: 'r2', expires: 99 },
      })),
    };
    const store = new DatabaseOAuthCredentialsStore(
      supabase as any,
      KEY,
      async () => oauth as any,
    );
    const result = await store.getActiveApiKey('user-1');
    expect(result).toEqual({
      apiKey: 'token',
      provider: 'openai-codex',
      resultProvider: 'openai-codex',
    });
    expect(oauth.getOAuthApiKey).toHaveBeenCalledWith(
      'openai-codex',
      expect.objectContaining({ 'openai-codex': expect.any(Object) }),
    );
    expect(supabase._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials_ciphertext: expect.any(String),
        credentials_iv: expect.any(String),
        credentials_tag: expect.any(String),
        updated_at: expect.any(String),
      }),
    );
  });

  it('maps anthropic to anthropic-subscription result provider', async () => {
    const encrypted = encryptJson({ access: 'a', refresh: 'r', expires: 1 }, KEY);
    const supabase = buildSupabaseMock([
      {
        id: 'row-2',
        provider: 'anthropic' as AiSubscriptionProvider,
        credentials_ciphertext: encrypted.credentialsCiphertext,
        credentials_iv: encrypted.credentialsIv,
        credentials_tag: encrypted.credentialsTag,
      },
    ]);
    const oauth = {
      getOAuthApiKey: vi.fn(async () => ({ apiKey: 'claude-token', newCredentials: { access: 'a', refresh: 'r', expires: 9 } })),
    };
    const store = new DatabaseOAuthCredentialsStore(
      supabase as any,
      KEY,
      async () => oauth as any,
    );
    const result = await store.getActiveApiKey('user-1');
    expect(result).toEqual({
      apiKey: 'claude-token',
      provider: 'anthropic',
      resultProvider: 'anthropic-subscription',
    });
  });

  it('persists refreshed credentials when pi-ai rotates tokens', async () => {
    const encryptedOld = encryptJson({ access: 'old', refresh: 'r', expires: 1 }, KEY);
    const supabase = buildSupabaseMock([
      {
        id: 'row-3',
        provider: 'openai-codex' as AiSubscriptionProvider,
        credentials_ciphertext: encryptedOld.credentialsCiphertext,
        credentials_iv: encryptedOld.credentialsIv,
        credentials_tag: encryptedOld.credentialsTag,
      },
    ]);
    const oauth = {
      getOAuthApiKey: vi.fn(async () => ({
        apiKey: 'rotated',
        newCredentials: { access: 'new-access', refresh: 'new-refresh', expires: 1234 },
      })),
    };
    const store = new DatabaseOAuthCredentialsStore(
      supabase as any,
      KEY,
      async () => oauth as any,
    );
    await store.getActiveApiKey('user-1');
    const updateCall = supabase._chain.update.mock.calls[0][0];
    expect(updateCall.credentials_ciphertext).not.toContain('new-access');
    expect(updateCall.credentials_ciphertext).not.toContain('new-refresh');
  });

  it('does not rewrite credentials when pi-ai returns unchanged tokens', async () => {
    const credentials = { access: 'same', refresh: 'same-refresh', expires: 1234 };
    const encrypted = encryptJson(credentials, KEY);
    const supabase = buildSupabaseMock([
      {
        id: 'row-4',
        provider: 'openai-codex' as AiSubscriptionProvider,
        credentials_ciphertext: encrypted.credentialsCiphertext,
        credentials_iv: encrypted.credentialsIv,
        credentials_tag: encrypted.credentialsTag,
      },
    ]);
    const store = new DatabaseOAuthCredentialsStore(
      supabase as any,
      KEY,
      async () => ({
        getOAuthApiKey: vi.fn(async () => ({ apiKey: 'token', newCredentials: credentials })),
      }) as any,
    );

    await store.getActiveApiKey('user-1');

    expect(supabase._chain.update).not.toHaveBeenCalled();
  });

  it('does not hide database failures as missing credentials', async () => {
    const supabase = buildSupabaseMock([]);
    supabase._chain.single.mockResolvedValue({
      data: null,
      error: { code: 'XX000', message: 'database unavailable' },
    });
    const store = new DatabaseOAuthCredentialsStore(
      supabase as any,
      KEY,
      async () => ({}) as any,
    );

    await expect(store.getActiveApiKey('user-1')).rejects.toThrow('database unavailable');
  });
});
