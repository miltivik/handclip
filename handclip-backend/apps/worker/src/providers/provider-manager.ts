import OpenAI from 'openai';
import { join } from 'path';
import { loadPiAiOAuth } from './pi-ai-loader';
import { OAuthCredentialsStore } from './oauth-credentials.store';
import { PiProviderAdapter, PiProviderResult } from './pi-provider.adapter';

export type ApiKeyProviderName = 'openai' | 'anthropic' | 'openrouter';
export type SubscriptionProviderName = 'openai-codex' | 'anthropic-subscription';
export type ProviderName = ApiKeyProviderName | SubscriptionProviderName;
export type LlmProviderSelection = 'api-key' | SubscriptionProviderName;

export interface ProviderConfig {
  name: ApiKeyProviderName;
  apiKey: string;
  baseURL?: string;
  defaultModel: string;
  costPer1MInput: number;
  costPer1MOutput: number;
}

export interface StageTask {
  stage: 'transcription' | 'clip-analysis' | 'captions' | 'broll';
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ProviderResult {
  provider: ProviderName;
  model: string;
  content: string;
  usage: { inputTokens: number; outputTokens: number };
}

interface OAuthCredentialsReader {
  getApiKey(provider: string): Promise<string | null>;
}

interface PiProviderCaller {
  call(request: {
    provider: 'openai-codex' | 'anthropic';
    resultProvider: ProviderName;
    model: string;
    apiKey: string;
    task: StageTask;
  }): Promise<PiProviderResult>;
}

type OpenAiCaller = (provider: ProviderConfig, task: StageTask) => Promise<ProviderResult>;

export interface ProviderManagerOptions {
  env?: NodeJS.ProcessEnv;
  oauthCredentialsStore?: OAuthCredentialsReader;
  piAdapter?: PiProviderCaller;
  openAiCaller?: OpenAiCaller;
}

export class AllProvidersFailed extends Error {
  constructor(stage: string) {
    super(`Todos los providers para ${stage} fallaron`);
    this.name = 'AllProvidersFailed';
  }
}

function createDefaultProviders(env: NodeJS.ProcessEnv): ProviderConfig[] {
  return [
    {
      name: 'openai',
      apiKey: env.OPENAI_API_KEY || '',
      defaultModel: 'gpt-4o-mini',
      costPer1MInput: 0.15,
      costPer1MOutput: 0.6,
    },
    {
      name: 'anthropic',
      apiKey: env.ANTHROPIC_API_KEY || '',
      defaultModel: env.HANDCLIP_ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      costPer1MInput: 0.125,
      costPer1MOutput: 1.25,
    },
    {
      name: 'openrouter',
      apiKey: env.OPENROUTER_API_KEY || '',
      baseURL: 'https://openrouter.ai/api/v1',
      defaultModel: 'openai/gpt-4o-mini',
      costPer1MInput: 0.15,
      costPer1MOutput: 0.6,
    },
  ];
}

function parseSelection(value: string | undefined): LlmProviderSelection {
  const selection = value || 'api-key';
  if (
    selection !== 'api-key' &&
    selection !== 'openai-codex' &&
    selection !== 'anthropic-subscription'
  ) {
    throw new Error(`Invalid HANDCLIP_LLM_PROVIDER: ${selection}`);
  }
  return selection;
}

function errorMetadata(error: any): string {
  return String(error?.status || error?.code || error?.name || 'unknown');
}

function isRetryable(error: any): boolean {
  return (
    error?.status === 429 ||
    error?.status === 500 ||
    error?.status === 502 ||
    error?.status === 503 ||
    error?.code === 'ECONNRESET' ||
    error?.code === 'ETIMEDOUT' ||
    error?.message?.includes('timeout')
  );
}

export class ProviderManager {
  private readonly rateLimits = new Map<string, { count: number; resetAt: number }>();
  private readonly MAX_RPM = 50;
  private readonly providers: ProviderConfig[];
  private readonly env: NodeJS.ProcessEnv;
  private readonly selection: LlmProviderSelection;
  private readonly allowApiKeyFallback: boolean;
  private readonly oauthCredentialsStore: OAuthCredentialsReader;
  private readonly piAdapter: PiProviderCaller;
  private readonly openAiCaller: OpenAiCaller;
  private byokConfig: { enabled: boolean; provider: ApiKeyProviderName; apiKey: string } | null =
    null;

  constructor(options: ProviderManagerOptions = {}) {
    const env = options.env || process.env;
    this.env = env;
    this.providers = createDefaultProviders(env);
    this.selection = parseSelection(env.HANDCLIP_LLM_PROVIDER);
    this.allowApiKeyFallback = env.HANDCLIP_LLM_ALLOW_API_KEY_FALLBACK !== 'false';
    this.piAdapter = options.piAdapter || new PiProviderAdapter();
    this.openAiCaller = options.openAiCaller || this.callOpenAiCompatible.bind(this);
    this.oauthCredentialsStore =
      options.oauthCredentialsStore ||
      new OAuthCredentialsStore(
        env.HANDCLIP_OAUTH_CREDENTIALS_PATH || join(process.cwd(), '.local', 'auth.json'),
        async (provider, credentials) => {
          const piAiOAuth = await loadPiAiOAuth();
          return piAiOAuth.getOAuthApiKey(provider, credentials);
        },
      );
  }

  enableBYOK(provider: ApiKeyProviderName, apiKey: string) {
    this.byokConfig = { enabled: true, provider, apiKey };
    const configuredProvider = this.providers.find((item) => item.name === provider);
    if (configuredProvider) configuredProvider.apiKey = apiKey;
  }

  disableBYOK() {
    this.byokConfig = null;
  }

  async callWithFallback(task: StageTask): Promise<ProviderResult> {
    if (this.selection !== 'api-key') {
      try {
        return await this.callSubscriptionProvider(this.selection, task);
      } catch (error) {
        console.warn(
          `[ProviderManager] ${this.selection}: OAuth unavailable (${errorMetadata(error)})`,
        );
        if (!this.allowApiKeyFallback) {
          throw error;
        }
        console.warn('[ProviderManager] Falling back to configured API-key providers');
      }
    }

    return this.callApiKeyProviders(task);
  }

  private async callSubscriptionProvider(
    provider: SubscriptionProviderName,
    task: StageTask,
  ): Promise<ProviderResult> {
    const oauthProvider = provider === 'openai-codex' ? 'openai-codex' : 'anthropic';
    const apiKey = await this.oauthCredentialsStore.getApiKey(oauthProvider);
    if (!apiKey) {
      throw new Error(`No OAuth credentials found for ${oauthProvider}`);
    }

    return this.piAdapter.call({
      provider: oauthProvider,
      resultProvider: provider,
      model:
        provider === 'openai-codex'
          ? this.env.HANDCLIP_CODEX_MODEL || 'gpt-5.3-codex'
          : this.env.HANDCLIP_ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      apiKey,
      task,
    }) as Promise<ProviderResult>;
  }

  private async callApiKeyProviders(task: StageTask): Promise<ProviderResult> {
    const ranked = this.rankProviders();

    for (const provider of ranked) {
      try {
        if (provider.name === 'anthropic') {
          return (await this.piAdapter.call({
            provider: 'anthropic',
            resultProvider: 'anthropic',
            model: provider.defaultModel,
            apiKey: provider.apiKey,
            task,
          })) as ProviderResult;
        }

        return await this.openAiCaller(provider, task);
      } catch (error) {
        if (!isRetryable(error)) {
          throw error;
        }
        console.warn(
          `[ProviderManager] ${provider.name}: retryable failure (${errorMetadata(error)}), trying next`,
        );
      }
    }

    throw new AllProvidersFailed(task.stage);
  }

  private rankProviders(): ProviderConfig[] {
    return [...this.providers]
      .filter((provider) => provider.apiKey && this.checkRateLimit(provider.name))
      .sort((a, b) => a.costPer1MInput - b.costPer1MInput);
  }

  private checkRateLimit(providerName: string): boolean {
    const now = Date.now();
    const limit = this.rateLimits.get(providerName);
    if (!limit || now > limit.resetAt) {
      this.rateLimits.set(providerName, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    if (limit.count >= this.MAX_RPM) return false;
    limit.count++;
    return true;
  }

  private async callOpenAiCompatible(
    provider: ProviderConfig,
    task: StageTask,
  ): Promise<ProviderResult> {
    const openai = new OpenAI({
      apiKey: provider.apiKey,
      baseURL: provider.baseURL,
    });

    const response = await openai.chat.completions.create({
      model: provider.defaultModel,
      messages: [
        { role: 'system', content: task.systemPrompt },
        { role: 'user', content: task.userPrompt },
      ],
      max_tokens: task.maxTokens || 2000,
      temperature: task.temperature || 0.3,
      response_format: { type: 'json_object' },
    });

    return {
      provider: provider.name,
      model: provider.defaultModel,
      content: response.choices[0]?.message?.content || '',
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      },
    };
  }
}

export const providerManager = new ProviderManager();
