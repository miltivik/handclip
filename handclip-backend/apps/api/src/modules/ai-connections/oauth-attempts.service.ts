import { randomUUID } from 'crypto';
import { AiSubscriptionProvider, EncryptedCredentials } from '@handclip/shared';
import { AiConnectionsService, OAuthCredentials } from './ai-connections.service';
export { OAuthCredentials };

export type AttemptStatus =
  | 'initializing'
  | 'awaiting-user'
  | 'connected'
  | 'failed'
  | 'cancelled'
  | 'expired';

export interface PublicOAuthAttempt {
  id: string;
  provider: AiSubscriptionProvider;
  status: AttemptStatus;
  authorizationUrl?: string;
  userCode?: string;
  verificationUri?: string;
  intervalSeconds?: number;
  expiresAt: string;
  error?: string;
}

interface InternalAttempt extends PublicOAuthAttempt {
  userId: string;
  manualCodeResolver?: (input: string) => void;
  cancelled: boolean;
  awaitingResolver?: () => void;
  expirationTimer?: ReturnType<typeof setTimeout>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

export interface OAuthAttemptDeviceCode {
  userCode: string;
  verificationUri: string;
  intervalSeconds?: number;
  expiresInSeconds?: number;
}

export interface OAuthAttemptAuthInfo {
  url: string;
  instructions?: string;
}

export type CodexLoginFn = (options: {
  onDeviceCode: (info: OAuthAttemptDeviceCode) => void;
}) => Promise<OAuthCredentials>;

export type AnthropicLoginFn = (options: {
  onAuth: (info: OAuthAttemptAuthInfo) => void;
  onPrompt: (prompt: { message: string }) => Promise<string>;
  onManualCodeInput: () => Promise<string>;
}) => Promise<OAuthCredentials>;

export interface OAuthLoginModule {
  loginOpenAICodexDeviceCode: CodexLoginFn;
  loginAnthropic: AnthropicLoginFn;
}

export type OAuthLoader = () => Promise<OAuthLoginModule>;

export class OAuthAttemptNotFoundError extends Error {
  constructor(attemptId: string) {
    super(`OAuth attempt not found: ${attemptId}`);
    this.name = 'OAuthAttemptNotFoundError';
  }
}

export class OAuthAttemptNotOwnedError extends Error {
  constructor() {
    super('OAuth attempt does not belong to this user');
    this.name = 'OAuthAttemptNotOwnedError';
  }
}

export class OAuthAttemptExpiredError extends Error {
  constructor(attemptId: string) {
    super(`OAuth attempt expired: ${attemptId}`);
    this.name = 'OAuthAttemptExpiredError';
  }
}

export class OAuthAttemptInvalidStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthAttemptInvalidStateError';
  }
}

const ATTEMPT_TTL_MS = 10 * 60 * 1000;

export class OAuthAttemptManager {
  private readonly attempts = new Map<string, InternalAttempt>();
  private readonly connections: AiConnectionsService;
  private readonly oauthLoader: OAuthLoader;

  constructor(
    connections: AiConnectionsService,
    oauthLoader: OAuthLoader,
  ) {
    this.connections = connections;
    this.oauthLoader = oauthLoader;
  }

  async start(userId: string, provider: AiSubscriptionProvider): Promise<PublicOAuthAttempt> {
    const id = randomUUID();
    const attempt: InternalAttempt = {
      id,
      userId,
      provider,
      status: 'initializing',
      expiresAt: new Date(Date.now() + ATTEMPT_TTL_MS).toISOString(),
      cancelled: false,
    };
    this.attempts.set(id, attempt);
    this.scheduleExpiration(attempt);

    const awaitingUser = new Promise<void>((resolve) => {
      attempt.awaitingResolver = resolve;
    });

    void this.run(attempt).catch((error) => {
      if (attempt.status === 'expired') {
        return;
      }
      attempt.status = 'failed';
      attempt.error = sanitizeError(error);
      attempt.awaitingResolver?.();
    });

    let waitTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      awaitingUser,
      new Promise((resolve) => {
        waitTimer = setTimeout(resolve, 5000);
      }),
    ]);
    if (waitTimer) {
      clearTimeout(waitTimer);
    }

    return this.toPublic(attempt);
  }

  async get(userId: string, attemptId: string): Promise<PublicOAuthAttempt> {
    const attempt = this.requireAttempt(attemptId);
    this.assertOwnership(attempt, userId);
    this.applyExpiration(attempt);
    return this.toPublic(attempt);
  }

  async submitInput(userId: string, attemptId: string, input: string): Promise<PublicOAuthAttempt> {
    const attempt = this.requireAttempt(attemptId);
    this.assertOwnership(attempt, userId);
    this.applyExpiration(attempt);
    if (attempt.provider !== 'anthropic') {
      throw new OAuthAttemptInvalidStateError('Manual input is only supported for Anthropic attempts');
    }
    if (!attempt.manualCodeResolver) {
      throw new OAuthAttemptInvalidStateError('OAuth attempt is not waiting for manual input');
    }
    attempt.manualCodeResolver(input.trim());
    attempt.manualCodeResolver = undefined;
    // Wait briefly for completion so the caller receives the final status.
    for (let i = 0; i < 100; i++) {
      if (attempt.status === 'connected' || attempt.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    this.applyExpiration(attempt);
    return this.toPublic(attempt);
  }

  private async run(attempt: InternalAttempt): Promise<void> {
    const oauth = await this.oauthLoader();
    let credentials: OAuthCredentials;
    try {
      if (attempt.provider === 'openai-codex') {
        credentials = await oauth.loginOpenAICodexDeviceCode({
          onDeviceCode: (info) => {
            attempt.status = 'awaiting-user';
            attempt.userCode = info.userCode;
            attempt.verificationUri = info.verificationUri;
            attempt.intervalSeconds = info.intervalSeconds;
            if (info.expiresInSeconds) {
              attempt.expiresAt = new Date(Date.now() + info.expiresInSeconds * 1000).toISOString();
              this.scheduleExpiration(attempt);
            }
            attempt.awaitingResolver?.();
          },
        });
      } else {
        credentials = await oauth.loginAnthropic({
          onAuth: (info) => {
            attempt.status = 'awaiting-user';
            attempt.authorizationUrl = info.url;
            attempt.awaitingResolver?.();
          },
          onPrompt: async () => {
            throw new OAuthAttemptInvalidStateError('Prompt input is not supported in mobile flow');
          },
          onManualCodeInput: () => {
            if (attempt.cancelled || attempt.status === 'expired') {
              return Promise.reject(new OAuthAttemptInvalidStateError('OAuth attempt is no longer active'));
            }
            return new Promise<string>((resolve) => {
              attempt.manualCodeResolver = (input: string) => resolve(input);
            });
          },
        });
      }
    } catch (error) {
      if (attempt.status === 'expired') {
        return;
      }
      if (attempt.cancelled) {
        attempt.status = 'cancelled';
        return;
      }
      attempt.status = 'failed';
      attempt.error = sanitizeError(error);
      attempt.awaitingResolver?.();
      return;
    }

    if (attempt.cancelled) {
      attempt.status = 'cancelled';
      this.scheduleCleanup(attempt);
      return;
    }

    if (this.isExpired(attempt)) {
      attempt.status = 'expired';
      this.scheduleCleanup(attempt);
      return;
    }

    try {
      await this.connections.upsertConnection(attempt.userId, {
        provider: attempt.provider,
        connectionType: 'oauth',
        credentials,
      });
      attempt.status = 'connected';
    } catch (error) {
      attempt.status = 'failed';
      attempt.error = sanitizeError(error);
    }
    this.scheduleCleanup(attempt);
    attempt.awaitingResolver?.();
  }

  private requireAttempt(attemptId: string): InternalAttempt {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) {
      throw new OAuthAttemptNotFoundError(attemptId);
    }
    return attempt;
  }

  private assertOwnership(attempt: InternalAttempt, userId: string): void {
    if (attempt.userId !== userId) {
      throw new OAuthAttemptNotOwnedError();
    }
  }

  private applyExpiration(attempt: InternalAttempt): void {
    if (attempt.status === 'connected' || attempt.status === 'failed' || attempt.status === 'cancelled') {
      return;
    }
    if (Date.parse(attempt.expiresAt) <= Date.now()) {
      attempt.status = 'expired';
      this.scheduleCleanup(attempt);
      throw new OAuthAttemptExpiredError(attempt.id);
    }
  }

  private isExpired(attempt: InternalAttempt): boolean {
    return Date.parse(attempt.expiresAt) <= Date.now();
  }

  private scheduleExpiration(attempt: InternalAttempt): void {
    if (attempt.expirationTimer) {
      clearTimeout(attempt.expirationTimer);
    }
    const delay = Math.max(0, Date.parse(attempt.expiresAt) - Date.now());
    attempt.expirationTimer = setTimeout(() => {
      if (attempt.status === 'initializing' || attempt.status === 'awaiting-user') {
        attempt.status = 'expired';
        attempt.manualCodeResolver = undefined;
        this.scheduleCleanup(attempt);
      }
    }, delay);
    attempt.expirationTimer.unref?.();
  }

  private scheduleCleanup(attempt: InternalAttempt): void {
    if (attempt.expirationTimer) {
      clearTimeout(attempt.expirationTimer);
      attempt.expirationTimer = undefined;
    }
    if (attempt.cleanupTimer) {
      return;
    }
    attempt.cleanupTimer = setTimeout(() => {
      this.attempts.delete(attempt.id);
    }, 60_000);
    attempt.cleanupTimer.unref?.();
  }

  private toPublic(attempt: InternalAttempt): PublicOAuthAttempt {
    return {
      id: attempt.id,
      provider: attempt.provider,
      status: attempt.status,
      authorizationUrl: attempt.authorizationUrl,
      userCode: attempt.userCode,
      verificationUri: attempt.verificationUri,
      intervalSeconds: attempt.intervalSeconds,
      expiresAt: attempt.expiresAt,
      error: attempt.error,
    };
  }
}

const SANITIZE_KEYS = ['code', 'access', 'refresh', 'token', 'secret', 'verifier', 'pasted'];

function sanitizeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'OAuth failed';
  }
  let message = error.message || 'OAuth failed';
  for (const key of SANITIZE_KEYS) {
    const regex = new RegExp(`(${key}\\s*=\\s*|${key}\\s*:\\s*)${VALUE_PATTERN}`, 'gi');
    message = message.replace(regex, `$1<redacted>`);
  }
  return message;
}

const VALUE_PATTERN = '(?:\\?[^\\s,;&]+|[^\\s,;&]+)';

export type { EncryptedCredentials };
