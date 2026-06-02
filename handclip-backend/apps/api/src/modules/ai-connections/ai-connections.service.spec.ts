import { ConfigService } from '@nestjs/config';
import {
  AiSubscriptionProvider,
  EncryptedCredentials,
  encryptJson,
} from '@handclip/shared';
import { Test } from '@nestjs/testing';
import { SupabaseService } from '../supabase/supabase.service';
import {
  AiConnectionsService,
  AiConnectionMetadata,
  OAuthCredentials,
  ProviderNotConnectedError,
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

async function buildService() {
  const supabase = buildSupabaseMock();
  const config = { getOrThrow: jest.fn((name: string) => (name === 'AI_CONNECTIONS_ENCRYPTION_KEY' ? KEY : '')) };
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
        isActive: true,
        connectedAt: '2026-06-02T00:00:00.000Z',
      },
    ]);
  });

  it('encrypts credentials before upserting and never stores plaintext', async () => {
    const { service, supabase } = await buildService();
    const chain = supabase.queueChain();
    chain.upsert.mockResolvedValue({ error: null });

    await service.upsertCredentials('user-1', 'anthropic', credentials);

    expect(chain.upsert).toHaveBeenCalledTimes(1);
    const payload = chain.upsert.mock.calls[0][0];
    expect(payload.provider).toBe('anthropic');
    expect(payload.credentials_ciphertext).toEqual(expect.any(String));
    expect(payload.credentials_ciphertext).not.toContain('refresh-secret');
    expect(payload.credentials_iv).toEqual(expect.any(String));
    expect(payload.credentials_tag).toEqual(expect.any(String));
    expect(payload.is_active).toBe(false);
  });

  it('refuses to activate a provider that is not connected', async () => {
    const { service, supabase } = await buildService();
    const chain = supabase.queueChain();
    chain.select.mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    });

    await expect(service.setActive('user-1', 'openai-codex')).rejects.toBeInstanceOf(
      ProviderNotConnectedError,
    );
  });

  it('activates a connected provider by clearing the previous active row', async () => {
    const { service, supabase } = await buildService();
    const lookupChain = supabase.queueChain();
    const clearChain = supabase.queueChain();
    const activateChain = supabase.queueChain();
    lookupChain.select.mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { provider: 'openai-codex' },
            error: null,
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
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    });

    await service.setActive('user-1', 'openai-codex');

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
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    });

    await service.disconnect('user-1', 'anthropic');
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

  it('validates the encryption key length at construction', async () => {
    const supabase = buildSupabaseMock();
    const config = { getOrThrow: jest.fn(() => Buffer.alloc(16).toString('base64')) };
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
