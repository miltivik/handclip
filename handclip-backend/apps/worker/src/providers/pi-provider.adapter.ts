import { loadPiAi, PiAiModule } from './pi-ai-loader';

export interface PiProviderTask {
  stage: 'transcription' | 'clip-analysis' | 'captions' | 'broll';
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}

export interface PiProviderCall {
  provider: 'openai-codex' | 'anthropic';
  resultProvider: string;
  model: string;
  apiKey: string;
  task: PiProviderTask;
}

export interface PiProviderResult {
  provider: string;
  model: string;
  content: string;
  usage: { inputTokens: number; outputTokens: number };
}

export type PiAiLoader = () => Promise<PiAiModule>;

export class PiProviderAdapter {
  constructor(private readonly load: PiAiLoader = loadPiAi) {}

  async call(request: PiProviderCall): Promise<PiProviderResult> {
    const piAi = await this.load();
    const model = piAi.getModel(request.provider, request.model);
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
}
