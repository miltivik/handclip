import { SupabaseClient } from '@supabase/supabase-js';
import {
  AiSubscriptionProvider,
  EncryptedCredentials,
  decryptJson,
  encryptJson,
  parseEncryptionKey,
} from '@handclip/shared';
import { loadPiAiOAuth, PiAiOAuthModule } from './pi-ai-loader';

export interface ActiveOAuthSelection {
  apiKey: string;
  provider: AiSubscriptionProvider;
  resultProvider: 'openai-codex' | 'anthropic-subscription';
}

interface ConnectionRow {
  id: string;
  provider: AiSubscriptionProvider;
  credentials_ciphertext: string;
  credentials_iv: string;
  credentials_tag: string;
}

export type OAuthLoader = () => Promise<PiAiOAuthModule>;

export class DatabaseOAuthCredentialsStore {
  private readonly key: Buffer;

  constructor(
    private readonly supabase: SupabaseClient,
    encryptionKey: string,
    private readonly oauthLoader: OAuthLoader = loadPiAiOAuth,
  ) {
    this.key = parseEncryptionKey(encryptionKey);
  }

  async getActiveApiKey(userId: string): Promise<ActiveOAuthSelection | null> {
    const { data, error } = await this.supabase
      .from('ai_provider_connections')
      .select('id, provider, credentials_ciphertext, credentials_iv, credentials_tag')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();
    if (error || !data) {
      return null;
    }
    const row = data as ConnectionRow;
    const credentials = this.decrypt(row);
    const oauth = await this.oauthLoader();
    const result = await oauth.getOAuthApiKey(row.provider, { [row.provider]: credentials });
    if (!result) {
      return null;
    }
    await this.persistRefresh(row.id, result.newCredentials);
    return {
      apiKey: result.apiKey,
      provider: row.provider,
      resultProvider: row.provider === 'anthropic' ? 'anthropic-subscription' : 'openai-codex',
    };
  }

  private decrypt(row: ConnectionRow) {
    return decryptJson<{ access: string; refresh: string; expires: number; [key: string]: unknown }>(
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
    await this.supabase
      .from('ai_provider_connections')
      .update({
        credentials_ciphertext: encrypted.credentialsCiphertext,
        credentials_iv: encrypted.credentialsIv,
        credentials_tag: encrypted.credentialsTag,
        updated_at: new Date().toISOString(),
      })
      .eq('id', rowId);
  }
}
