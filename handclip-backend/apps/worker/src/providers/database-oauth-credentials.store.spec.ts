import { encryptJson } from '@handclip/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseAiConnectionStore } from './database-ai-connection.store';

const KEY = Buffer.alloc(32, 5).toString('base64');

function buildSupabaseMock(rows: any[] = [], options: { activeError?: any } = {}) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(
      options.activeError
        ? { data: null, error: options.activeError }
        : { data: rows[0] ?? null, error: rows.length === 0 ? { code: 'PGRST116' } : null },
    ),
  };
  return {
    from: vi.fn(() => chain),
    _chain: chain,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DatabaseAiConnectionStore', () => {
  it('returns null when no active connection exists', async () => {
    const supabase = buildSupabaseMock([]);
    const store = new DatabaseAiConnectionStore(
      supabase as any,
      KEY,
      async () => ({ loginOpenAICodexDeviceCode: vi.fn(), loginAnthropic: vi.fn() }) as any,
    );
    await expect(store.getActiveApiKey('missing-user')).resolves.toBeNull();
  });

  it('resolves Codex OAuth active connection and returns api key with refreshed credentials', async () => {
    const encrypted = encryptJson({ access: 'old', refresh: 'r', expires: 1 }, KEY);
    const supabase = buildSupabaseMock([
      {
        id: 'row-1',
        provider: 'openai-codex',
        connection_type: 'oauth',
        model: null,
        base_url: null,
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
    const store = new DatabaseAiConnectionStore(
      supabase as any,
      KEY,
      async () => oauth as any,
    );
    const result = await store.getActiveApiKey('user-1');
    expect(result).toEqual({
      type: 'oauth',
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

  it('maps anthropic OAuth to anthropic-subscription result provider', async () => {
    const encrypted = encryptJson({ access: 'a', refresh: 'r', expires: 1 }, KEY);
    const supabase = buildSupabaseMock([
      {
        id: 'row-2',
        provider: 'anthropic',
        connection_type: 'oauth',
        model: null,
        base_url: null,
        credentials_ciphertext: encrypted.credentialsCiphertext,
        credentials_iv: encrypted.credentialsIv,
        credentials_tag: encrypted.credentialsTag,
      },
    ]);
    const oauth = {
      getOAuthApiKey: vi.fn(async () => ({
        apiKey: 'claude-token',
        newCredentials: { access: 'a', refresh: 'r', expires: 9 },
      })),
    };
    const store = new DatabaseAiConnectionStore(
      supabase as any,
      KEY,
      async () => oauth as any,
    );
    const result = await store.getActiveApiKey('user-1');
    expect(result).toEqual({
      type: 'oauth',
      apiKey: 'claude-token',
      provider: 'anthropic',
      resultProvider: 'anthropic-subscription',
    });
  });

  it('resolves an API-key connection without leaking the secret', async () => {
    const encrypted = encryptJson(
      { type: 'api-key', apiKey: 'sk-very-secret' },
      KEY,
    );
    const supabase = buildSupabaseMock([
      {
        id: 'row-apikey',
        provider: 'openrouter',
        connection_type: 'api-key',
        model: 'openai/gpt-4o-mini',
        base_url: null,
        credentials_ciphertext: encrypted.credentialsCiphertext,
        credentials_iv: encrypted.credentialsIv,
        credentials_tag: encrypted.credentialsTag,
      },
    ]);
    const store = new DatabaseAiConnectionStore(
      supabase as any,
      KEY,
      async () => ({}) as any,
    );
    const result = await store.getActiveApiKey('user-1');
    expect(result).toEqual({
      type: 'api-key',
      apiKey: 'sk-very-secret',
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
      baseUrl: null,
      resultProvider: 'openrouter',
    });
    expect(supabase._chain.update).not.toHaveBeenCalled();
  });

  it('resolves an openai-compatible custom connection preserving base URL', async () => {
    const encrypted = encryptJson(
      {
        type: 'openai-compatible',
        apiKey: 'sk-local',
        baseUrl: 'http://192.168.0.10:11434/v1',
        model: 'llama-3.1-8b',
      },
      KEY,
    );
    const supabase = buildSupabaseMock([
      {
        id: 'row-custom',
        provider: 'custom',
        connection_type: 'openai-compatible',
        model: 'llama-3.1-8b',
        base_url: 'http://192.168.0.10:11434/v1',
        credentials_ciphertext: encrypted.credentialsCiphertext,
        credentials_iv: encrypted.credentialsIv,
        credentials_tag: encrypted.credentialsTag,
      },
    ]);
    const store = new DatabaseAiConnectionStore(
      supabase as any,
      KEY,
      async () => ({}) as any,
    );
    const result = await store.getActiveApiKey('user-1');
    expect(result).toEqual({
      type: 'api-key',
      apiKey: 'sk-local',
      provider: 'custom',
      model: 'llama-3.1-8b',
      baseUrl: 'http://192.168.0.10:11434/v1',
      resultProvider: 'custom',
    });
  });

  it('persists refreshed OAuth credentials when pi-ai rotates tokens', async () => {
    const encryptedOld = encryptJson({ access: 'old', refresh: 'r', expires: 1 }, KEY);
    const supabase = buildSupabaseMock([
      {
        id: 'row-3',
        provider: 'openai-codex',
        connection_type: 'oauth',
        model: null,
        base_url: null,
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
    const store = new DatabaseAiConnectionStore(
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
        provider: 'openai-codex',
        connection_type: 'oauth',
        model: null,
        base_url: null,
        credentials_ciphertext: encrypted.credentialsCiphertext,
        credentials_iv: encrypted.credentialsIv,
        credentials_tag: encrypted.credentialsTag,
      },
    ]);
    const store = new DatabaseAiConnectionStore(
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
    const supabase = buildSupabaseMock([], { activeError: { code: 'XX000', message: 'database unavailable' } });
    const store = new DatabaseAiConnectionStore(
      supabase as any,
      KEY,
      async () => ({}) as any,
    );

    await expect(store.getActiveApiKey('user-1')).rejects.toThrow('database unavailable');
  });

  it('logs and rethrows OAuth refresh errors instead of returning null', async () => {
    const encrypted = encryptJson({ access: 'a', refresh: 'r', expires: 1 }, KEY);
    const supabase = buildSupabaseMock([
      {
        id: 'row-refresh-fail',
        provider: 'openai-codex',
        connection_type: 'oauth',
        model: null,
        base_url: null,
        credentials_ciphertext: encrypted.credentialsCiphertext,
        credentials_iv: encrypted.credentialsIv,
        credentials_tag: encrypted.credentialsTag,
      },
    ]);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const oauth = {
      getOAuthApiKey: vi.fn(async () => {
        throw new Error('refresh-token rejected');
      }),
    };
    const store = new DatabaseAiConnectionStore(
      supabase as any,
      KEY,
      async () => oauth as any,
    );

    await expect(store.getActiveApiKey('user-1')).rejects.toThrow(
      'OAuth refresh failed for openai-codex',
    );
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns null (with a warning) when OAuth credentials are invalid', async () => {
    const encrypted = encryptJson({ access: 'a', refresh: 'r', expires: 1 }, KEY);
    const supabase = buildSupabaseMock([
      {
        id: 'row-null-refresh',
        provider: 'anthropic',
        connection_type: 'oauth',
        model: null,
        base_url: null,
        credentials_ciphertext: encrypted.credentialsCiphertext,
        credentials_iv: encrypted.credentialsIv,
        credentials_tag: encrypted.credentialsTag,
      },
    ]);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const oauth = { getOAuthApiKey: vi.fn(async () => null) };
    const store = new DatabaseAiConnectionStore(
      supabase as any,
      KEY,
      async () => oauth as any,
    );

    await expect(store.getActiveApiKey('user-1')).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('throws when an API-key connection is missing its model', async () => {
    const encrypted = encryptJson({ type: 'api-key', apiKey: 'sk-x' }, KEY);
    const supabase = buildSupabaseMock([
      {
        id: 'row-no-model',
        provider: 'openrouter',
        connection_type: 'api-key',
        model: null,
        base_url: null,
        credentials_ciphertext: encrypted.credentialsCiphertext,
        credentials_iv: encrypted.credentialsIv,
        credentials_tag: encrypted.credentialsTag,
      },
    ]);
    const store = new DatabaseAiConnectionStore(
      supabase as any,
      KEY,
      async () => ({}) as any,
    );

    await expect(store.getActiveApiKey('user-1')).rejects.toThrow(
      /missing required model/,
    );
  });
});
