import { OpenAiCompatibleConnectionBodySchema } from './ai-connections.dto';
import { ConfigService } from '@nestjs/config';
import {
  EncryptedCredentials,
  encryptJson,
} from '@handclip/shared';
import { Test } from '@nestjs/testing';
import { SupabaseService } from '../supabase/supabase.service';
import {
  AiConnectionsService,
  AiConnectionMetadata,
  InvalidConnectionPayloadError,
  OAuthCredentials,
  ProviderNotConnectedError,
  UnsupportedProviderError,
} from './ai-connections.service';

type SupabaseChain = any;

function buildSupabaseMock() {
  const chains: SupabaseChain[] = [];
  const queue: SupabaseChain[] = [];
  const make = (): SupabaseChain => {
    const chain: any = {
      upsert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
    };
    return chain;
  };
  const from = jest.fn(() => {
    if (queue.length > 0) {
      const next = queue.shift()!;
      chains.push(next);
      return next;
    }
    const chain = make();
    chains.push(chain);
    return chain;
  });
  return {
    getServiceRoleClient: jest.fn(() => ({ from })),
    queueChain: (): SupabaseChain => {
      const chain = make();
      queue.push(chain);
      return chain;
    },
    chains,
  };
}

const KEY = Buffer.alloc(32, 7).toString('base64');

async function buildService(allowPrivate = false) {
  const supabase = buildSupabaseMock();
  const config = {
    getOrThrow: jest.fn((name: string) => (name === 'AI_CONNECTIONS_ENCRYPTION_KEY' ? KEY : '')),
    get: jest.fn((name: string) => {
      if (name === 'ALLOW_PRIVATE_AI_ENDPOINTS') return allowPrivate ? 'true' : undefined;
      return undefined;
    }),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      AiConnectionsService,
      { provide: SupabaseService, useValue: supabase },
      { provide: ConfigService, useValue: config },
    ],
  }).compile();
  return { service: moduleRef.get(AiConnectionsService), supabase, config };
}

const credentials: OAuthCredentials = {
  access: 'access-secret',
  refresh: 'refresh-secret',
  expires: 123,
};

describe('AiConnectionsService', () => {
  it('lists only connected providers as metadata without leaking ciphertext', async () => {
    const { service, supabase } = await buildService();
    const chain = supabase.queueChain();
    chain.select.mockReturnValue({
      eq: jest.fn().mockResolvedValue({
        data: [
          {
            provider: 'openai-codex',
            connection_type: 'oauth',
            model: null,
            base_url: null,
            is_active: true,
            updated_at: '2026-06-02T00:00:00.000Z',
          },
        ],
        error: null,
      }),
    });

    const result = await service.list('user-1');
    expect(result).toEqual<AiConnectionMetadata[]>([
      {
        provider: 'openai-codex',
        connectionType: 'oauth',
        model: null,
        baseUrl: null,
        isActive: true,
        connectedAt: '2026-06-02T00:00:00.000Z',
      },
    ]);
  });

  it('encrypts OAuth credentials before upserting and never stores plaintext', async () => {
    const { service, supabase } = await buildService();
    const chain = supabase.queueChain();
    chain.upsert.mockResolvedValue({ error: null });

    await service.upsertConnection('user-1', {
      provider: 'anthropic',
      connectionType: 'oauth',
      credentials,
    });

    expect(chain.upsert).toHaveBeenCalledTimes(1);
    const payload = chain.upsert.mock.calls[0][0];
    expect(payload.provider).toBe('anthropic');
    expect(payload.connection_type).toBe('oauth');
    expect(payload.credentials_ciphertext).toEqual(expect.any(String));
    expect(payload.credentials_ciphertext).not.toContain('refresh-secret');
    expect(payload.credentials_iv).toEqual(expect.any(String));
    expect(payload.credentials_tag).toEqual(expect.any(String));
    expect(payload.is_active).toBe(false);
    expect(payload.model).toBeNull();
  });

  it('encrypts API-key credentials and persists model without leaking secret', async () => {
    const { service, supabase } = await buildService();
    const chain = supabase.queueChain();
    chain.upsert.mockResolvedValue({ error: null });

    await service.upsertConnection('user-1', {
      provider: 'openrouter',
      connectionType: 'api-key',
      credentials: { type: 'api-key', apiKey: 'sk-very-secret-1234' },
      model: 'openai/gpt-4o-mini',
    });

    const payload = chain.upsert.mock.calls[0][0];
    expect(payload.provider).toBe('openrouter');
    expect(payload.connection_type).toBe('api-key');
    expect(payload.model).toBe('openai/gpt-4o-mini');
    expect(payload.credentials_ciphertext).not.toContain('sk-very-secret-1234');
    expect(payload.credentials_ciphertext).not.toContain('sk-very-secret-1234');
  });

  it('persists base URL and model for openai-compatible custom connections', async () => {
    const { service, supabase } = await buildService();
    const chain = supabase.queueChain();
    chain.upsert.mockResolvedValue({ error: null });

    await service.upsertConnection('user-1', {
      provider: 'custom',
      connectionType: 'openai-compatible',
      credentials: {
        type: 'openai-compatible',
        apiKey: 'sk-local',
        baseUrl: 'http://192.168.0.10:11434/v1',
        model: 'llama-3.1-8b',
      },
      model: 'llama-3.1-8b',
      baseUrl: 'http://192.168.0.10:11434/v1',
    });

    const payload = chain.upsert.mock.calls[0][0];
    expect(payload.provider).toBe('custom');
    expect(payload.connection_type).toBe('openai-compatible');
    expect(payload.base_url).toBe('http://192.168.0.10:11434/v1');
    expect(payload.model).toBe('llama-3.1-8b');
    expect(payload.credentials_ciphertext).not.toContain('sk-local');
  });

  it('validates and normalises API-key request body', () => {
    const { service } = Promise.resolve(buildService()) as any;
    // Build synchronously by using an instance directly.
    const instance = new AiConnectionsService(
      { getServiceRoleClient: () => ({ from: () => ({}) }) } as any,
      { getOrThrow: () => KEY, get: () => undefined } as any,
    );
    expect(() =>
      instance.validateApiKeyRequest({
        provider: 'unknown' as never,
        apiKey: 'k',
        model: 'm',
      }),
    ).toThrow(UnsupportedProviderError);
    expect(() =>
      instance.validateApiKeyRequest({ provider: 'openrouter', apiKey: '', model: 'm' }),
    ).toThrow(InvalidConnectionPayloadError);
    expect(() =>
      instance.validateApiKeyRequest({ provider: 'openrouter', apiKey: 'k', model: '' }),
    ).toThrow(InvalidConnectionPayloadError);
    const out = instance.validateApiKeyRequest({
      provider: 'openrouter',
      apiKey: '  k  ',
      model: '  openai/gpt-4o-mini  ',
    });
    expect(out).toEqual({ provider: 'openrouter', model: 'openai/gpt-4o-mini' });
  });

  it('validates openai-compatible request body and strips trailing slash', () => {
    const instance = new AiConnectionsService(
      { getServiceRoleClient: () => ({ from: () => ({}) }) } as any,
      { getOrThrow: () => KEY, get: () => undefined } as any,
    );
    const out = instance.validateOpenAiCompatibleRequest({
      provider: 'custom',
      apiKey: 'k',
      model: 'm',
      baseUrl: 'http://example.com/v1/',
    });
    expect(out.baseUrl).toBe('http://example.com/v1');
    // Note: URL validation is now handled by the controller (SSRF guard).
    // validateOpenAiCompatibleRequest only checks required fields and format.
    expect(() =>
      instance.validateOpenAiCompatibleRequest({
        provider: 'openrouter' as never,
        apiKey: 'k',
        model: 'm',
        baseUrl: 'http://example.com',
      }),
    ).toThrow(InvalidConnectionPayloadError);
    expect(() =>
      instance.validateOpenAiCompatibleRequest({
        provider: 'custom',
        apiKey: '',
        model: 'm',
        baseUrl: 'http://example.com',
      }),
    ).toThrow(InvalidConnectionPayloadError);
  });

  it('refuses to activate a provider that is not connected', async () => {
    const { service, supabase } = await buildService();
    const chain = supabase.queueChain();
    chain.select.mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    });

    await expect(
      service.setActive('user-1', 'openai-codex', 'oauth'),
    ).rejects.toBeInstanceOf(ProviderNotConnectedError);
  });

  it('activates a connected provider by clearing the previous active row', async () => {
    const { service, supabase } = await buildService();
    const lookupChain = supabase.queueChain();
    const clearChain = supabase.queueChain();
    const activateChain = supabase.queueChain();
    lookupChain.select.mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: { provider: 'openai-codex', connection_type: 'oauth' },
              error: null,
            }),
          }),
        }),
      }),
    });
    clearChain.update.mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    });
    activateChain.update.mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      }),
    });

    await service.setActive('user-1', 'openai-codex', 'oauth');

    expect(clearChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ is_active: false }),
    );
    expect(activateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ is_active: true, updated_at: expect.any(String) }),
    );
  });

  it('disconnects a provider by deleting the encrypted row', async () => {
    const { service, supabase } = await buildService();
    const chain = supabase.queueChain();
    chain.delete.mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      }),
    });

    await service.disconnect('user-1', 'anthropic', 'oauth');
    expect(chain.delete).toHaveBeenCalledTimes(1);
  });

  it('decrypts persisted credentials using service key', async () => {
    const { service } = await buildService();
    const encrypted: EncryptedCredentials = encryptJson(credentials, KEY);
    const decoded = service.decryptStoredCredentials({
      credentialsCiphertext: encrypted.credentialsCiphertext,
      credentialsIv: encrypted.credentialsIv,
      credentialsTag: encrypted.credentialsTag,
    });
    expect(decoded).toEqual(credentials);
  });

  it('never returns API-key secrets via list()', async () => {
    const { service, supabase } = await buildService();
    const chain = supabase.queueChain();
    chain.select.mockReturnValue({
      eq: jest.fn().mockResolvedValue({
        data: [
          {
            provider: 'openrouter',
            connection_type: 'api-key',
            model: 'openai/gpt-4o-mini',
            base_url: null,
            is_active: false,
            updated_at: '2026-06-02T00:00:00.000Z',
          },
        ],
        error: null,
      }),
    });
    const result = await service.list('user-1');
    expect(result[0].connectionType).toBe('api-key');
    expect(result[0].model).toBe('openai/gpt-4o-mini');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/ciphertext/i);
    expect(serialized).not.toMatch(/credentials_/i);
    expect(serialized).not.toMatch(/sk-/i);
  });

  it('validates the encryption key length at construction', async () => {
    const supabase = buildSupabaseMock();
    const config = { getOrThrow: jest.fn(() => Buffer.alloc(16).toString('base64')), get: jest.fn(() => undefined) };
    await expect(
      Test.createTestingModule({
        providers: [
          AiConnectionsService,
          { provide: SupabaseService, useValue: supabase },
          { provide: ConfigService, useValue: config },
        ],
      }).compile(),
    ).rejects.toThrow(/32 bytes/);
  });
});

describe('AiConnectionsService.validateAndListModels', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeAll(() => {
    originalFetch = globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('rejects invalid anthropic API key with 401', async () => {
    const { service } = await buildService();
    globalThis.fetch = jest.fn().mockResolvedValue({ status: 401 }) as any;
    await expect(
      service.validateAndListModels('anthropic', 'api-key', 'bad-key'),
    ).rejects.toThrow('API key inválida');
  });

  it('rejects invalid google API key with 403', async () => {
    const { service } = await buildService();
    globalThis.fetch = jest.fn().mockResolvedValue({ status: 403 }) as any;
    await expect(
      service.validateAndListModels('google', 'api-key', 'bad-key'),
    ).rejects.toThrow('API key inválida');
  });

  it('returns static models for valid anthropic key', async () => {
    const { service } = await buildService();
    globalThis.fetch = jest.fn().mockResolvedValue({ status: 200 }) as any;
    const result = await service.validateAndListModels('anthropic', 'api-key', 'sk-good');
    expect(result.ok).toBe(true);
    expect(result.models.length).toBeGreaterThan(0);
    expect(result.models.some((m: any) => m.id === 'claude-sonnet-4-6')).toBe(true);
  });

  it('rejects localhost baseUrl for openai-compatible when ALLOW_PRIVATE_AI_ENDPOINTS is false', async () => {
    const { service } = await buildService();
    await expect(
      service.validateAndListModels('custom', 'openai-compatible', 'key', 'http://localhost:11434/v1'),
    ).rejects.toThrow('blocked hostname');
  });

  it('allows localhost baseUrl for openai-compatible when ALLOW_PRIVATE_AI_ENDPOINTS is true', async () => {
    const supabase = buildSupabaseMock();
    const config = {
      getOrThrow: jest.fn((name: string) => (name === 'AI_CONNECTIONS_ENCRYPTION_KEY' ? KEY : '')),
      get: jest.fn((name: string) => (name === 'ALLOW_PRIVATE_AI_ENDPOINTS' ? 'true' : undefined)),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AiConnectionsService,
        { provide: SupabaseService, useValue: supabase },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    const svc = moduleRef.get(AiConnectionsService);
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: 'llama3', name: 'Llama 3' }] }),
    }) as any;
    const result = await svc.validateAndListModels('custom', 'openai-compatible', 'key', 'http://localhost:11434/v1');
    expect(result.ok).toBe(true);
    expect(result.models).toEqual([{ id: 'llama3', label: 'Llama 3' }]);
  });

  it('rejects 169.254.169.254 metadata URL', async () => {
    const { service } = await buildService();
    await expect(
      service.validateAndListModels('custom', 'openai-compatible', 'key', 'http://169.254.169.254/latest/meta-data'),
    ).rejects.toThrow('private/link-local IP');
  });

  it('rejects 127.0.0.1 for openai-compatible when not allowed', async () => {
    const { service } = await buildService();
    await expect(
      service.validateAndListModels('custom', 'openai-compatible', 'key', 'http://127.0.0.1:11434/v1'),
    ).rejects.toThrow('private/link-local IP');
  });
});

describe('OpenAiCompatibleConnectionBodySchema', () => {
  it('allows missing baseUrl (optional)', () => {
    const parsed = OpenAiCompatibleConnectionBodySchema.safeParse({
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.baseUrl).toBeUndefined();
    }
  });

  it('still validates baseUrl format when provided', () => {
    const parsed = OpenAiCompatibleConnectionBodySchema.safeParse({
      apiKey: 'sk-test',
      model: 'gpt-4o',
      baseUrl: 'ftp://bad',
    });
    expect(parsed.success).toBe(false);
  });
});
