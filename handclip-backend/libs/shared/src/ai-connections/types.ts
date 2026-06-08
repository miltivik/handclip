export type AiSubscriptionProvider = 'openai-codex' | 'anthropic';

export type ApiKeyProvider =
  | 'openai'
  | 'anthropic'
  | 'openrouter'
  | 'deepseek'
  | 'google'
  | 'mistral'
  | 'groq'
  | 'xai'
  | 'minimax'
  | 'zai'
  | 'minimax-token-plan'
  | 'zai-coding-plan'
  | 'custom';

export type AiProviderId = AiSubscriptionProvider | ApiKeyProvider;

export type AiConnectionType = 'oauth' | 'api-key' | 'openai-compatible';

/** Logical plan type used by the mobile UI to choose labels and flow. */
export type PlanType = 'standard' | 'token-plan' | 'coding-plan' | 'oauth' | 'custom';

/** How the backend discovers available models for a provider. */
export type ModelListStrategy = 'static' | 'api' | 'openai-compatible-models';

/** A single model returned by the validate/list-models flow. */
export interface ModelInfo {
  id: string;
  label: string;
  recommended?: boolean;
}


export interface EncryptedCredentials {
  credentialsCiphertext: string;
  credentialsIv: string;
  credentialsTag: string;
}

export interface OAuthConnectionPayload {
  type: 'oauth';
  access: string;
  refresh: string;
  expires: number;
  [key: string]: unknown;
}

export interface ApiKeyConnectionPayload {
  type: 'api-key';
  apiKey: string;
}

export interface OpenAiCompatibleConnectionPayload {
  type: 'openai-compatible';
  apiKey: string;
  baseUrl: string;
  model: string;
}

export type ConnectionPayload =
  | OAuthConnectionPayload
  | ApiKeyConnectionPayload
  | OpenAiCompatibleConnectionPayload;

export interface ProviderCatalogField {
  name: string;
  label: string;
  required: boolean;
  secret?: boolean;
  placeholder?: string;
  helperText?: string;
}

export interface ProviderCatalogEntry {
  id: AiProviderId;
  displayName: string;
  group: 'subscription' | 'key-plan' | 'api-key' | 'custom';
  connectionType: AiConnectionType;
  description: string;
  warning?: string;
  defaultModel?: string;
  defaultBaseUrl?: string;
  modelRequired: boolean;
  baseUrlRequired: boolean;
  apiKeyRequired: boolean;
  fields: ProviderCatalogField[];
  comingSoon?: boolean;
  supportedByPiAi: boolean;
  /** URL where the user can obtain an API key for this provider. */
  apiKeyUrl?: string;
  /** URL to the provider's API documentation. */
  docsUrl?: string;
  /** URL to the provider's model listing page. */
  modelsUrl?: string;
  /** Short label for the plan (e.g. "Token Plan", "Coding Plan"). */
  planLabel?: string;
  /** Logical plan type that controls UI behaviour. */
  planType?: PlanType;
  /** How to discover models for this provider. */
  modelListStrategy?: ModelListStrategy;
  /** Curated model list when modelListStrategy is 'static'. */
  staticModels?: ModelInfo[];
}
