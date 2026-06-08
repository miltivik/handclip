import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validateOpenAiCompatibleBaseUrl } from './ssrf-guard';
import {
  AiConnectionType,
  AiProviderId,
  AiSubscriptionProvider,
  ApiKeyProvider,
  ConnectionPayload,
  EncryptedCredentials,
  encryptJson,
  decryptJson,
  getProviderEntry,
  isSubscriptionProvider,
  ModelInfo,
  parseEncryptionKey,
} from '@handclip/shared';
import { SupabaseService } from '../supabase/supabase.service';

export type OAuthCredentials = {
  access: string;
  refresh: string;
  expires: number;
  [key: string]: unknown;
};

export interface ApiKeyConnectionRequest {
  provider: ApiKeyProvider;
  apiKey: string;
  model: string;
}

export interface OpenAiCompatibleConnectionRequest {
  provider: 'custom';
  apiKey: string;
  model: string;
  baseUrl: string;
}

export type UpsertConnectionRequest =
  | {
      provider: AiSubscriptionProvider;
      connectionType: 'oauth';
      credentials: { access: string; refresh: string; expires: number; [key: string]: unknown };
    }
  | {
      provider: ApiKeyProvider;
      connectionType: 'api-key' | 'openai-compatible';
      credentials: ConnectionPayload;
      model: string;
      baseUrl?: string;
    };

export interface AiConnectionMetadata {
  provider: AiProviderId;
  connectionType: AiConnectionType;
  model: string | null;
  baseUrl: string | null;
  isActive: boolean;
  connectedAt: string;
}

interface ConnectionRow {
  provider: AiProviderId;
  connection_type: AiConnectionType;
  model: string | null;
  base_url: string | null;
  is_active: boolean;
  updated_at: string;
  credentials_ciphertext: string;
  credentials_iv: string;
  credentials_tag: string;
}

export class ProviderNotConnectedError extends Error {
  constructor(provider: AiProviderId, connectionType: AiConnectionType) {
    super(`Provider is not connected: ${provider} (${connectionType})`);
    this.name = 'ProviderNotConnectedError';
  }
}

export class UnsupportedProviderError extends Error {
  constructor(provider: string) {
    super(`Unsupported provider: ${provider}`);
    this.name = 'UnsupportedProviderError';
  }
}

export class InvalidConnectionPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidConnectionPayloadError';
  }
}

@Injectable()
export class AiConnectionsService {
  private readonly encryptionKey: string;
  private readonly allowPrivateEndpoints: boolean;

  constructor(
    private readonly supabaseService: SupabaseService,
    config: ConfigService,
  ) {
    this.encryptionKey = config.getOrThrow<string>('AI_CONNECTIONS_ENCRYPTION_KEY');
    parseEncryptionKey(this.encryptionKey);
    this.allowPrivateEndpoints = config.get<string>('ALLOW_PRIVATE_AI_ENDPOINTS') === 'true';
  }

  async list(userId: string): Promise<AiConnectionMetadata[]> {
    const { data, error } = await this.supabaseService
      .getServiceRoleClient()
      .from('ai_provider_connections')
      .select(
        'provider, connection_type, model, base_url, is_active, updated_at',
      )
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to list AI connections: ${error.message}`);
    }

    return ((data as Array<
      Pick<
        ConnectionRow,
        'provider' | 'connection_type' | 'model' | 'base_url' | 'is_active' | 'updated_at'
      >
    >) || []).map((row) => ({
      provider: row.provider,
      connectionType: row.connection_type,
      model: row.model,
      baseUrl: row.base_url,
      isActive: row.is_active,
      connectedAt: row.updated_at,
    }));
  }

  async upsertConnection(
    userId: string,
    request: UpsertConnectionRequest,
  ): Promise<void> {
    const encrypted = encryptJson(request.credentials, this.encryptionKey);
    const baseRow = {
      user_id: userId,
      provider: request.provider,
      connection_type: request.connectionType,
      model: request.connectionType === 'oauth' ? null : request.model,
      base_url:
        request.connectionType === 'openai-compatible'
          ? request.baseUrl ?? null
          : null,
      credentials_ciphertext: encrypted.credentialsCiphertext,
      credentials_iv: encrypted.credentialsIv,
      credentials_tag: encrypted.credentialsTag,
      is_active: false,
      updated_at: new Date().toISOString(),
    };

    const { error } = await this.supabaseService
      .getServiceRoleClient()
      .from('ai_provider_connections')
      .upsert(baseRow, {
        onConflict: 'user_id,provider,connection_type',
      });

    if (error) {
      throw new Error(`Failed to persist AI connection: ${error.message}`);
    }
  }

  async setActive(
    userId: string,
    provider: AiProviderId,
    connectionType: AiConnectionType,
  ): Promise<void> {
    const connection = await this.getConnectionRow(userId, provider, connectionType);
    if (!connection) {
      throw new ProviderNotConnectedError(provider, connectionType);
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
      .eq('provider', provider)
      .eq('connection_type', connectionType);
    if (activate.error) {
      throw new Error(`Failed to activate provider: ${activate.error.message}`);
    }
  }

  async disconnect(
    userId: string,
    provider: AiProviderId,
    connectionType: AiConnectionType,
  ): Promise<void> {
    const { error } = await this.supabaseService
      .getServiceRoleClient()
      .from('ai_provider_connections')
      .delete()
      .eq('user_id', userId)
      .eq('provider', provider)
      .eq('connection_type', connectionType);
    if (error) {
      throw new Error(`Failed to disconnect provider: ${error.message}`);
    }
  }

  decryptStoredCredentials<T = ConnectionPayload>(value: EncryptedCredentials): T {
    return decryptJson<T>(value, this.encryptionKey);
  }

  /**
   * Validates and normalises an API-key connection request.
   * Throws InvalidConnectionPayloadError for any problem.
   */
  validateApiKeyRequest(request: ApiKeyConnectionRequest): {
    provider: ApiKeyProvider;
    model: string;
  } {
    if (!request || typeof request !== 'object') {
      throw new InvalidConnectionPayloadError('Request body is required');
    }
    const entry = getProviderEntry(request.provider, 'api-key');
    if (!entry) {
      throw new UnsupportedProviderError(request.provider);
    }
    if (!request.apiKey || typeof request.apiKey !== 'string' || request.apiKey.trim().length === 0) {
      throw new InvalidConnectionPayloadError('apiKey is required');
    }
    if (request.apiKey.length > 1024) {
      throw new InvalidConnectionPayloadError('apiKey is too long');
    }
    if (!request.model || typeof request.model !== 'string' || request.model.trim().length === 0) {
      throw new InvalidConnectionPayloadError('model is required');
    }
    if (request.model.length > 256) {
      throw new InvalidConnectionPayloadError('model is too long');
    }
    return { provider: request.provider, model: request.model.trim() };
  }

  validateOpenAiCompatibleRequest(request: OpenAiCompatibleConnectionRequest): {
    model: string;
    baseUrl: string;
  } {
    if (!request || typeof request !== 'object') {
      throw new InvalidConnectionPayloadError('Request body is required');
    }
    if (request.provider !== 'custom' && request.provider !== 'zai-coding-plan') {
      throw new InvalidConnectionPayloadError('Only provider "custom" and "zai-coding-plan" support baseUrl');
    }
    if (!request.apiKey || typeof request.apiKey !== 'string' || request.apiKey.trim().length === 0) {
      throw new InvalidConnectionPayloadError('apiKey is required');
    }
    if (request.apiKey.length > 1024) {
      throw new InvalidConnectionPayloadError('apiKey is too long');
    }
    if (!request.model || typeof request.model !== 'string' || request.model.trim().length === 0) {
      throw new InvalidConnectionPayloadError('model is required');
    }
    if (request.model.length > 256) {
      throw new InvalidConnectionPayloadError('model is too long');
    }
    if (!request.baseUrl || typeof request.baseUrl !== 'string') {
      throw new InvalidConnectionPayloadError('baseUrl is required');
    }
    // Note: baseUrl is normalised and SSRF-checked by the controller before calling this method.
    return { model: request.model.trim(), baseUrl: request.baseUrl.trim().replace(/\/+$/, '') };
  }

  /**
   * Validates a baseUrl against SSRF rules. Returns the normalised URL.
   * Uses the service-level allowPrivateEndpoints flag.
   */
  async sanitizeBaseUrl(baseUrl: string): Promise<string> {
    return validateOpenAiCompatibleBaseUrl(baseUrl, this.allowPrivateEndpoints);
  }

  private async getConnectionRow(
    userId: string,
    provider: AiProviderId,
    connectionType: AiConnectionType,
  ): Promise<Pick<ConnectionRow, 'provider' | 'connection_type'> | null> {
    const { data, error } = await this.supabaseService
      .getServiceRoleClient()
      .from('ai_provider_connections')
      .select('provider, connection_type')
      .eq('user_id', userId)
      .eq('provider', provider)
      .eq('connection_type', connectionType)
      .single();
    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new Error(`Failed to lookup connection: ${error.message}`);
    }
    return data as Pick<ConnectionRow, 'provider' | 'connection_type'> | null;
  }

  async validateAndListModels(
    provider: string,
    connectionType: string,
    apiKey: string,
    baseUrl?: string,
  ): Promise<{ ok: true; provider: string; connectionType: string; models: ModelInfo[]; defaultModel?: string }> {
    const entry = getProviderEntry(provider, connectionType);
    if (!entry) {
      throw new Error(`No se encontró configuración para el provider: ${provider}`);
    }

    const strategy = entry.modelListStrategy;

    if (strategy === 'static') {
      // Validate key — re-throw auth errors so caller knows the key is invalid.
      // Providers with no lightweight endpoint skip validation internally.
      await this.validateStaticProviderKey(provider, apiKey);
      return {
        ok: true,
        provider,
        connectionType,
        models: entry.staticModels ?? [],
        defaultModel: entry.defaultModel,
      };
    }

    if (strategy === 'api') {
      const models = await this.fetchModelsFromApi(provider, apiKey);
      return {
        ok: true,
        provider,
        connectionType,
        models,
        defaultModel: entry.defaultModel,
      };
    }

    if (strategy === 'openai-compatible-models') {
      if (!baseUrl) {
        throw new Error('baseUrl es requerido para proveedores openai-compatible');
      }
      const safeBaseUrl = await this.sanitizeBaseUrl(baseUrl);
      const models = await this.fetchOpenAiCompatibleModels(safeBaseUrl, apiKey);
      return {
        ok: true,
        provider,
        connectionType,
        models,
        defaultModel: entry.defaultModel,
      };
    }

    throw new Error(`Estrategia de lista de modelos no soportada: ${strategy}`);
  }

  private async validateStaticProviderKey(provider: string, apiKey: string): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      if (provider === 'anthropic') {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
            'x-api-key': apiKey,
          },
          body: JSON.stringify({ model: 'claude-3-5-haiku-20241022', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
          signal: controller.signal,
        });
        if (res.status === 401 || res.status === 403) {
          throw new Error('API key inválida');
        }
      } else if (provider === 'google') {
        const res = await fetch(
          'https://generativelanguage.googleapis.com/v1/models',
          {
            headers: { 'x-goog-api-key': apiKey },
            signal: controller.signal,
          },
        );
        if (res.status === 401 || res.status === 403) {
          throw new Error('API key inválida');
        }
      } else if (provider === 'minimax' || provider === 'zai' || provider === 'minimax-token-plan' || provider === 'zai-coding-plan') {
        // No known lightweight validation endpoint for these providers — skip validation
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Tiempo de espera agotado al validar la API key');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchModelsFromApi(provider: string, apiKey: string): Promise<ModelInfo[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const endpoints: Record<string, { url: string; auth: string }> = {
      openai: { url: 'https://api.openai.com/v1/models', auth: `Bearer ${apiKey}` },
      openrouter: { url: 'https://openrouter.ai/api/v1/models', auth: `Bearer ${apiKey}` },
      deepseek: { url: 'https://api.deepseek.com/v1/models', auth: `Bearer ${apiKey}` },
      mistral: { url: 'https://api.mistral.ai/v1/models', auth: `Bearer ${apiKey}` },
      groq: { url: 'https://api.groq.com/openai/v1/models', auth: `Bearer ${apiKey}` },
      xai: { url: 'https://api.x.ai/v1/models', auth: `Bearer ${apiKey}` },
    };

    const ep = endpoints[provider];
    if (!ep) {
      throw new Error(`Provider no soportado para listado via API: ${provider}`);
    }

    try {
      const res = await fetch(ep.url, {
        headers: { Authorization: ep.auth, 'content-type': 'application/json' },
        signal: controller.signal,
      });
      if (res.status === 401 || res.status === 403) {
        throw new Error('API key inválida');
      }
      if (!res.ok) {
        throw new Error(`Error del proveedor: ${res.status} ${res.statusText}`);
      }
      const data = await res.json() as { data: Array<{ id: string; name?: string }> };
      let models = (data.data ?? []).map((m) => ({ id: m.id, label: m.name ?? m.id }));
      if (provider === 'openrouter') {
        models = models.sort((a, b) => a.id.localeCompare(b.id)).slice(0, 200);
      }
      return models;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Tiempo de espera agotado al obtener la lista de modelos');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchOpenAiCompatibleModels(baseUrl: string, apiKey: string): Promise<ModelInfo[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
        headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        signal: controller.signal,
        redirect: 'manual',
      });
      if (!res.ok) {
        return [];
      }
      const data = await res.json() as { data: Array<{ id: string; name?: string }> };
      return (data.data ?? []).map((m) => ({ id: m.id, label: m.name ?? m.id }));
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function isApiKeyConnectionType(value: string): value is 'api-key' {
  return value === 'api-key';
}

export function isOpenAiCompatibleConnectionType(value: string): value is 'openai-compatible' {
  return value === 'openai-compatible';
}

export function isAiSubscriptionProvider(value: string): value is AiSubscriptionProvider {
  return isSubscriptionProvider(value);
}
