import { SupabaseClient } from '@supabase/supabase-js';
import {
  AiConnectionType,
  AiProviderId,
  EncryptedCredentials,
  decryptJson,
  encryptJson,
  isSubscriptionProvider,
  parseEncryptionKey,
} from '@handclip/shared';
import { loadPiAiOAuth, PiAiOAuthModule } from './pi-ai-loader';

export interface ActiveOAuthSelection {
  type: 'oauth';
  apiKey: string;
  provider: 'openai-codex' | 'anthropic';
  resultProvider: 'openai-codex' | 'anthropic-subscription';
}

export interface ActiveApiKeySelection {
  type: 'api-key';
  apiKey: string;
  provider: AiProviderId;
  model: string;
  baseUrl: string | null;
  resultProvider: string;
}

export type ActiveSelection = ActiveOAuthSelection | ActiveApiKeySelection;

interface ConnectionRow {
  id: string;
  provider: AiProviderId;
  connection_type: AiConnectionType;
  model: string | null;
  base_url: string | null;
  credentials_ciphertext: string;
  credentials_iv: string;
  credentials_tag: string;
}

export type OAuthLoader = () => Promise<PiAiOAuthModule>;

export class DatabaseAiConnectionStore {
  private readonly key: Buffer;

  constructor(
    private readonly supabase: SupabaseClient,
    encryptionKey: string,
    private readonly oauthLoader: OAuthLoader = loadPiAiOAuth,
  ) {
    this.key = parseEncryptionKey(encryptionKey);
  }

  async getActiveApiKey(userId: string): Promise<ActiveSelection | null> {
    const { data, error } = await this.supabase
      .from('ai_provider_connections')
      .select(
        'id, provider, connection_type, model, base_url, credentials_ciphertext, credentials_iv, credentials_tag',
      )
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();
    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new Error(`Failed to load AI connection: ${error.message}`);
    }
    if (!data) {
      return null;
    }
    const row = data as ConnectionRow;

    if (row.connection_type === 'oauth') {
      return this.resolveOauth(row);
    }
    return this.resolveApiKey(row);
  }

  private async resolveOauth(row: ConnectionRow): Promise<ActiveOAuthSelection | null> {
    if (!isSubscriptionProvider(row.provider)) {
      return null;
    }
    const credentials = this.decrypt<{ access: string; refresh: string; expires: number; [key: string]: unknown }>(row);
    const oauth = await this.oauthLoader();
    let result: { apiKey: string; newCredentials: { access: string; refresh: string; expires: number; [key: string]: unknown } } | null;
    try {
      result = await oauth.getOAuthApiKey(row.provider, { [row.provider]: credentials });
    } catch (e) {
      console.warn(
        `[DatabaseAiConnectionStore] OAuth refresh failed for user=${row.id} provider=${row.provider}: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
      throw new Error(
        `OAuth refresh failed for ${row.provider}: ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
    if (!result) {
      console.warn(
        `[DatabaseAiConnectionStore] OAuth credentials for ${row.provider} are invalid or expired (row=${row.id})`,
      );
      return null;
    }
    if (JSON.stringify(credentials) !== JSON.stringify(result.newCredentials)) {
      await this.persistRefresh(row.id, result.newCredentials);
    }
    return {
      type: 'oauth',
      apiKey: result.apiKey,
      provider: row.provider,
      resultProvider: row.provider === 'anthropic' ? 'anthropic-subscription' : 'openai-codex',
    };
  }

  private resolveApiKey(row: ConnectionRow): ActiveApiKeySelection | null {
    const payload = this.decrypt<{ apiKey?: string }>(row);
    if (!payload?.apiKey) {
      throw new Error(`Persisted API key is empty for ${row.provider} (row=${row.id})`);
    }
    if (!row.model) {
      throw new Error(
        `Persisted API key for ${row.provider} is missing required model (row=${row.id})`,
      );
    }
    return {
      type: 'api-key',
      apiKey: payload.apiKey,
      provider: this.mapProviderForRuntime(row.provider),
      model: row.model,
      baseUrl: row.base_url,
      resultProvider: this.buildResultProvider(row.provider, row.connection_type),
    };
  }

  private buildResultProvider(provider: AiProviderId, type: AiConnectionType): string {
    if (type === 'openai-compatible') {
      return 'custom';
    }
    return this.mapProviderForRuntime(provider);
  }

  /** Map plan-specific provider IDs to their base runtime provider for pi-ai. */
  private mapProviderForRuntime(provider: AiProviderId): AiProviderId {
    if (provider === 'minimax-token-plan') return 'minimax' as AiProviderId;
    return provider;
  }

  private decrypt<T>(row: ConnectionRow): T {
    return decryptJson<T>(
      {
        credentialsCiphertext: row.credentials_ciphertext,
        credentialsIv: row.credentials_iv,
        credentialsTag: row.credentials_tag,
      } satisfies EncryptedCredentials,
      this.key.toString('base64'),
    );
  }

  private async persistRefresh(
    rowId: string,
    credentials: { access: string; refresh: string; expires: number; [key: string]: unknown },
  ): Promise<void> {
    const encrypted = encryptJson(credentials, this.key.toString('base64'));
    const { error } = await this.supabase
      .from('ai_provider_connections')
      .update({
        credentials_ciphertext: encrypted.credentialsCiphertext,
        credentials_iv: encrypted.credentialsIv,
        credentials_tag: encrypted.credentialsTag,
        updated_at: new Date().toISOString(),
      })
      .eq('id', rowId);
    if (error) {
      throw new Error(`Failed to persist refreshed OAuth credentials: ${error.message}`);
    }
  }
}

/**
 * @deprecated Use DatabaseAiConnectionStore. Kept as an alias for backwards
 * compatibility with modules that imported the original name.
 */
export { DatabaseAiConnectionStore as DatabaseOAuthCredentialsStore };
