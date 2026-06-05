import { AiSubscriptionProvider } from '@handclip/shared';
import { AiConnectionsService, OAuthCredentials } from './ai-connections.service';
import {
  OAuthAttemptExpiredError,
  OAuthAttemptManager,
  OAuthAttemptNotFoundError,
  OAuthAttemptNotOwnedError,
} from './oauth-attempts.service';

const KEY = Buffer.alloc(32, 7).toString('base64');

function buildConnectionsMock() {
  return {
    upsertCredentials: jest.fn(async (_u: string, _p: AiSubscriptionProvider, _c: OAuthCredentials) => {}),
  } as unknown as AiConnectionsService;
}

interface LoginOptions {
  onDeviceCode?: (info: { userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number }) => void;
  onAuth?: (info: { url: string; instructions?: string }) => void;
  onPrompt?: (prompt: { message: string }) => Promise<string>;
  onManualCodeInput?: () => Promise<string>;
}

interface FakeOAuthModule {
  loginOpenAICodexDeviceCode: (options: LoginOptions) => Promise<{
    access: string;
    refresh: string;
    expires: number;
    [key: string]: unknown;
  }>;
  loginAnthropic: (options: LoginOptions) => Promise<{
    access: string;
    refresh: string;
    expires: number;
    [key: string]: unknown;
  }>;
}

function fakeOAuth(
  codex: (options: LoginOptions) => Promise<any>,
  anthropic: (options: LoginOptions) => Promise<any> = codex,
): () => Promise<FakeOAuthModule> {
  return async () => ({
    loginOpenAICodexDeviceCode: codex,
    loginAnthropic: anthropic,
  });
}

describe('OAuthAttemptManager', () => {
  it('publishes Codex device code and persists successful credentials', async () => {
    const connections = buildConnectionsMock();
    const codex = jest.fn(async (options: LoginOptions) => {
      options.onDeviceCode?.({ userCode: 'ABCD-EFGH', verificationUri: 'https://example.test/device', expiresInSeconds: 600, intervalSeconds: 5 });
      return { access: 'a', refresh: 'r', expires: 123, accountId: 'acc' };
    });
    const manager = new OAuthAttemptManager(connections as any, fakeOAuth(codex) as any);
    const started = await manager.start('user-1', 'openai-codex');
    expect(started.status).toBe('awaiting-user');
    expect(started.userCode).toBe('ABCD-EFGH');
    expect(started.verificationUri).toBe('https://example.test/device');
    expect(started.intervalSeconds).toBe(5);
    expect(started.expiresAt).toEqual(expect.any(String));

    // Allow async completion
    await new Promise((r) => setTimeout(r, 10));
    const status = await manager.get('user-1', started.id);
    expect(status.status).toBe('connected');
    expect(connections.upsertCredentials).toHaveBeenCalledWith(
      'user-1',
      'openai-codex',
      expect.objectContaining({ access: 'a', refresh: 'r', expires: 123, accountId: 'acc' }),
    );
  });

  it('publishes Anthropic auth URL and resolves submitted manual input', async () => {
    const connections = buildConnectionsMock();
    const anthropic = jest.fn(async (options: LoginOptions) => {
      options.onAuth?.({ url: 'https://example.test/authorize' });
      const code = await options.onManualCodeInput!();
      return { access: 'a', refresh: 'r', expires: 123, code };
    });
    const manager = new OAuthAttemptManager(connections as any, fakeOAuth(jest.fn(), anthropic) as any);
    const started = await manager.start('user-1', 'anthropic');
    expect(started.status).toBe('awaiting-user');
    expect(started.authorizationUrl).toBe('https://example.test/authorize');

    const result = await manager.submitInput('user-1', started.id, 'paste#code');
    expect(result.status).toBe('connected');
    expect(connections.upsertCredentials).toHaveBeenCalledWith(
      'user-1',
      'anthropic',
      expect.objectContaining({ code: 'paste#code' }),
    );
  });

  it('rejects attempt access by another user', async () => {
    const connections = buildConnectionsMock();
    const codex = jest.fn(async (options: LoginOptions) => {
      options.onDeviceCode?.({ userCode: 'CODE', verificationUri: 'https://example.test' });
      return { access: 'a', refresh: 'r', expires: 1 };
    });
    const manager = new OAuthAttemptManager(connections as any, fakeOAuth(codex) as any);
    const started = await manager.start('user-1', 'openai-codex');
    await expect(manager.get('attacker', started.id)).rejects.toBeInstanceOf(
      OAuthAttemptNotOwnedError,
    );
  });

  it('returns sanitized failure without pasted code', async () => {
    const connections = buildConnectionsMock();
    const anthropic = jest.fn(async (options: LoginOptions) => {
      options.onAuth?.({ url: 'https://example.test' });
      await options.onManualCodeInput!();
      throw new Error('invalid_grant pasted=super-secret-1234');
    });
    const manager = new OAuthAttemptManager(connections as any, fakeOAuth(jest.fn(), anthropic) as any);
    const started = await manager.start('user-1', 'anthropic');
    await manager.submitInput('user-1', started.id, 'super-secret-1234');
    await new Promise((r) => setTimeout(r, 10));
    const status = await manager.get('user-1', started.id);
    expect(status.status).toBe('failed');
    expect(status.error).toBeDefined();
    expect(status.error).not.toContain('super-secret-1234');
  });

  it('expires stale attempts and reports them as expired', async () => {
    const connections = buildConnectionsMock();
    let blockResolve: ((credentials: { access: string; refresh: string; expires: number }) => void) = () => undefined;
    const codex = jest.fn(async (options: LoginOptions) => {
      options.onDeviceCode?.({ userCode: 'CODE', verificationUri: 'https://example.test' });
      return new Promise<{ access: string; refresh: string; expires: number }>((resolve) => {
        blockResolve = resolve;
      });
    });
    const manager = new OAuthAttemptManager(connections as any, fakeOAuth(codex) as any);
    const started = await manager.start('user-1', 'openai-codex');
    expect(started.status).toBe('awaiting-user');
    // Force expiration by manually rewriting attempt expiration
    const internal = manager as any;
    const attempt = internal.attempts.get(started.id);
    attempt.expiresAt = new Date(Date.now() - 1000).toISOString();
    await expect(manager.get('user-1', started.id)).rejects.toBeInstanceOf(
      OAuthAttemptExpiredError,
    );
    // Clean up the dangling promise
    blockResolve({ access: 'a', refresh: 'r', expires: 1 });
    await new Promise((r) => setTimeout(r, 10));
    expect(connections.upsertCredentials).not.toHaveBeenCalled();
  });

  it('rejects unknown attempt ids', async () => {
    const connections = buildConnectionsMock();
    const manager = new OAuthAttemptManager(connections as any, fakeOAuth(jest.fn()) as any);
    await expect(manager.get('user-1', 'missing')).rejects.toBeInstanceOf(
      OAuthAttemptNotFoundError,
    );
  });
});
