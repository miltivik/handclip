import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiSubscriptionProvider,
  EncryptedCredentials,
  encryptJson,
  decryptJson,
  parseEncryptionKey,
} from '@handclip/shared';
import { SupabaseService } from '../supabase/supabase.service';

export interface OAuthCredentials {
  access: string;
  refresh: string;
  expires: number;
  [key: string]: unknown;
}

export interface AiConnectionMetadata {
  provider: AiSubscriptionProvider;
  isActive: boolean;
  connectedAt: string;
}

interface ConnectionRow {
  provider: AiSubscriptionProvider;
  is_active: boolean;
  updated_at: string;
  credentials_ciphertext: string;
  credentials_iv: string;
  credentials_tag: string;
}

export class ProviderNotConnectedError extends Error {
  constructor(provider: AiSubscriptionProvider) {
    super(`Provider is not connected: ${provider}`);
    this.name = 'ProviderNotConnectedError';
  }
}

@Injectable()
export class AiConnectionsService {
  private readonly encryptionKey: string;

  constructor(
    private readonly supabaseService: SupabaseService,
    config: ConfigService,
  ) {
    this.encryptionKey = config.getOrThrow<string>('AI_CONNECTIONS_ENCRYPTION_KEY');
    parseEncryptionKey(this.encryptionKey);
  }

  async list(userId: string): Promise<AiConnectionMetadata[]> {
    const { data, error } = await this.supabaseService
      .getServiceRoleClient()
      .from('ai_provider_connections')
      .select('provider, is_active, updated_at')
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to list AI connections: ${error.message}`);
    }

    return ((data as Array<Pick<ConnectionRow, 'provider' | 'is_active' | 'updated_at'>>) || []).map(
      (row) => ({
        provider: row.provider,
        isActive: row.is_active,
        connectedAt: row.updated_at,
      }),
    );
  }

  async upsertCredentials(
    userId: string,
    provider: AiSubscriptionProvider,
    credentials: OAuthCredentials,
  ): Promise<void> {
    const encrypted = encryptJson(credentials, this.encryptionKey);
    const { error } = await this.supabaseService
      .getServiceRoleClient()
      .from('ai_provider_connections')
      .upsert(
        {
          user_id: userId,
          provider,
          credentials_ciphertext: encrypted.credentialsCiphertext,
          credentials_iv: encrypted.credentialsIv,
          credentials_tag: encrypted.credentialsTag,
          is_active: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,provider' },
      );

    if (error) {
      throw new Error(`Failed to persist AI connection: ${error.message}`);
    }
  }

  async setActive(userId: string, provider: AiSubscriptionProvider): Promise<void> {
    const connection = await this.getConnectionRow(userId, provider);
    if (!connection) {
      throw new ProviderNotConnectedError(provider);
    }

    const client = this.supabaseService.getServiceRoleClient();
    const now = new Date().toISOString();

    const clear = await client
      .from('ai_provider_connections')
      .update({ is_active: false, updated_at: now })
      .eq('user_id', userId)
      .eq('is_active', true);
    if (clear.error) {
      throw new Error(`Failed to clear previous active connection: ${clear.error.message}`);
    }

    const activate = await client
      .from('ai_provider_connections')
      .update({ is_active: true, updated_at: now })
      .eq('user_id', userId)
      .eq('provider', provider);
    if (activate.error) {
      throw new Error(`Failed to activate provider: ${activate.error.message}`);
    }
  }

  async disconnect(userId: string, provider: AiSubscriptionProvider): Promise<void> {
    const { error } = await this.supabaseService
      .getServiceRoleClient()
      .from('ai_provider_connections')
      .delete()
      .eq('user_id', userId)
      .eq('provider', provider);
    if (error) {
      throw new Error(`Failed to disconnect provider: ${error.message}`);
    }
  }

  decryptStoredCredentials<T = OAuthCredentials>(value: EncryptedCredentials): T {
    return decryptJson<T>(value, this.encryptionKey);
  }

  private async getConnectionRow(
    userId: string,
    provider: AiSubscriptionProvider,
  ): Promise<Pick<ConnectionRow, 'provider'> | null> {
    const { data, error } = await this.supabaseService
      .getServiceRoleClient()
      .from('ai_provider_connections')
      .select('provider')
      .eq('user_id', userId)
      .eq('provider', provider)
      .single();
    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new Error(`Failed to lookup connection: ${error.message}`);
    }
    return data as Pick<ConnectionRow, 'provider'> | null;
  }
}
