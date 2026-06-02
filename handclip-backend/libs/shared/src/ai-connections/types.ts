export type AiSubscriptionProvider = 'openai-codex' | 'anthropic';

export interface EncryptedCredentials {
  credentialsCiphertext: string;
  credentialsIv: string;
  credentialsTag: string;
}
