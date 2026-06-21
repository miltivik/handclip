import OpenAI from 'openai';

export type ProviderName = 'openai' | 'anthropic' | 'openrouter';

export interface ProviderConfig {
  name: ProviderName;
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
  // Try this provider first regardless of cost order. Bypasses the
  // rate-limit filter (caller is explicitly asking for it).
  forceProvider?: ProviderName;
}

export interface ProviderResult {
  provider: ProviderName;
  model: string;
  content: string;
  usage: { inputTokens: number; outputTokens: number };
}

class AllProvidersFailed extends Error {
  constructor(stage: string) {
    super(`Todos los providers para ${stage} fallaron`);
    this.name = 'AllProvidersFailed';
  }
}

export class ProviderManager {
  private rateLimits = new Map<string, { count: number; resetAt: number }>();
  private readonly MAX_RPM = 50;
  private providers: ProviderConfig[] = [];

  private ensureProviders(): void {
    if (this.providers.length > 0) return;
    // ponytail: anthropic removed — the OpenAI SDK was being constructed
    // with baseURL=undefined for anthropic, so calls hit api.openai.com
    // with an Anthropic Bearer and 401'd on every attempt. Re-add with
    // @anthropic-ai/sdk when that becomes a real need.
    this.providers = [
      {
        name: 'openai',
        apiKey: process.env.OPENAI_API_KEY || '',
        defaultModel: 'gpt-4o-mini',
        costPer1MInput: 0.15,
        costPer1MOutput: 0.60,
      },
      {
        name: 'openrouter',
        apiKey: process.env.OPENROUTER_API_KEY || '',
        baseURL: 'https://openrouter.ai/api/v1',
        defaultModel: 'openai/gpt-4o-mini',
        costPer1MInput: 0.15,
        costPer1MOutput: 0.60,
      },
    ];
  }

  async callWithFallback(task: StageTask): Promise<ProviderResult> {
    this.ensureProviders();
    const ranked = this.rankProviders(task.stage);

    // If a forced provider is requested, try it first (bypassing the
    // rate-limit filter) and fall through to the cost-ranked list on
    // retryable failure.
    const forced = task.forceProvider
      ? this.providers.find((p) => p.name === task.forceProvider)
      : null;
    const ordered = forced
      ? [forced, ...ranked.filter((p) => p.name !== task.forceProvider)]
      : ranked;

    for (const provider of ordered) {
      if (!provider.apiKey) {
        console.warn(`[ProviderManager] ${provider.name}: sin API key, omitiendo`);
        continue;
      }

      try {
        return await this.callProvider(provider, task);
      } catch (err: any) {
        const isRetryable =
          err?.status === 429 ||
          err?.status === 500 ||
          err?.status === 502 ||
          err?.status === 503 ||
          err?.code === 'ECONNRESET' ||
          err?.code === 'ETIMEDOUT' ||
          err?.message?.includes('timeout');

        if (!isRetryable) {
          throw err;
        }
        console.warn(
          `[ProviderManager] ${provider.name} falló (${err?.status || err?.code}), probando siguiente...`,
        );
      }
    }

    throw new AllProvidersFailed(task.stage);
  }

  private rankProviders(stage: string): ProviderConfig[] {
    return [...this.providers]
      .filter((p) => p.apiKey && this.checkRateLimit(p.name))
      .sort((a, b) => a.costPer1MInput - b.costPer1MInput);
  }

  private checkRateLimit(providerName: string): boolean {
    const now = Date.now();
    const limit = this.rateLimits.get(providerName);
    if (!limit || now > limit.resetAt) {
      this.rateLimits.set(providerName, { count: 1, resetAt: now + 60000 });
      return true;
    }
    if (limit.count >= this.MAX_RPM) return false;
    limit.count++;
    return true;
  }

  private async callProvider(provider: ProviderConfig, task: StageTask): Promise<ProviderResult> {
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

    const content = response.choices[0]?.message?.content || '';

    return {
      provider: provider.name,
      model: provider.defaultModel,
      content,
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      },
    };
  }
}

export const providerManager = new ProviderManager();
