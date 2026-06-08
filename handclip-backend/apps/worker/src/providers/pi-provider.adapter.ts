import { loadPiAi, PiAiModule } from './pi-ai-loader';

export interface PiProviderTask {
  stage: 'transcription' | 'clip-analysis' | 'captions' | 'broll';
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}

export interface PiProviderCall {
  /**
   * The pi-ai provider id (e.g. `openai`, `anthropic`, `openai-codex`, `deepseek`,
   * `openrouter`, `google`, `mistral`, `groq`, `xai`, `zai`, `minimax`).
   * For custom openai-compatible endpoints use `provider: 'openai-completions'`
   * together with `baseURL` and `model` and the adapter will build the request
   * through pi-ai's openai-completions streaming path.
   */
  provider: string;
  resultProvider: string;
  model: string;
  apiKey: string;
  baseURL?: string;
  task: PiProviderTask;
}

export interface PiProviderResult {
  provider: string;
  model: string;
  content: string;
  usage: { inputTokens: number; outputTokens: number };
}

export type PiAiLoader = () => Promise<PiAiModule>;

const KNOWN_PIAI_PROVIDERS = new Set<string>([
  'openai',
  'anthropic',
  'openai-codex',
  'azure-openai-responses',
  'google',
  'google-vertex',
  'deepseek',
  'openrouter',
  'mistral',
  'groq',
  'xai',
  'zai',
  'minimax',
  'minimax-cn',
  'minimax-token-plan',
  'zai-coding-plan',
  'moonshotai',
  'huggingface',
  'fireworks',
  'together',
  'opencode',
  'opencode-go',
  'kimi-coding',
  'cloudflare-workers-ai',
  'cloudflare-ai-gateway',
  'xiaomi',
  'amazon-bedrock',
]);

export class PiProviderAdapter {
  constructor(private readonly load: PiAiLoader = loadPiAi) {}

  async call(request: PiProviderCall): Promise<PiProviderResult> {
    const piAi = await this.load();
    const providerId = this.resolveProviderId(request.provider, request.baseURL);
    const model = this.resolveModel(piAi, providerId, request.model, request.baseURL);
    const response = await piAi.complete(
      model,
      {
        systemPrompt: request.task.systemPrompt,
        messages: [
          {
            role: 'user',
            content: request.task.userPrompt,
            timestamp: Date.now(),
          },
        ],
      },
      { apiKey: request.apiKey },
    );

    if (response.stopReason === 'error') {
      throw new Error(response.errorMessage || `${request.resultProvider} request failed`);
    }

    return {
      provider: request.resultProvider,
      model: request.model,
      content: response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text || '')
        .join(''),
      usage: {
        inputTokens: response.usage.input,
        outputTokens: response.usage.output,
      },
    };
  }

  private resolveProviderId(provider: string, baseURL?: string): string {
    if (provider === 'custom' || baseURL) {
      return 'openai-completions';
    }
    if (KNOWN_PIAI_PROVIDERS.has(provider)) {
      return provider;
    }
    return provider;
  }

  private resolveModel(
    piAi: PiAiModule,
    providerId: string,
    modelId: string,
    baseURL?: string,
  ): unknown {
    if (providerId === 'openai-completions' || baseURL) {
      return this.buildOpenAiCompatibleModel(modelId, baseURL);
    }
    return piAi.getModel(providerId, modelId);
  }

  private buildOpenAiCompatibleModel(modelId: string, baseURL?: string): unknown {
    return {
      id: modelId,
      name: modelId,
      api: 'openai-completions',
      provider: 'custom',
      baseUrl: baseURL ?? 'http://localhost:11434/v1',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 32000,
    };
  }
}
