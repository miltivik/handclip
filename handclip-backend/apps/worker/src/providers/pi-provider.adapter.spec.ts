import { describe, expect, it, vi } from 'vitest';
import { PiProviderAdapter } from './pi-provider.adapter';

describe('PiProviderAdapter', () => {
  it('calls pi-ai with explicit token and normalizes text and usage', async () => {
    const model = { provider: 'openai-codex', id: 'gpt-5.3-codex' };
    const complete = vi.fn(async () => ({
      content: [
        { type: 'thinking', thinking: 'internal' },
        { type: 'text', text: '{"clips":[]}' },
        { type: 'text', text: '\n' },
      ],
      usage: { input: 12, output: 4 },
      stopReason: 'stop',
    }));
    const adapter = new PiProviderAdapter(async () => ({
      getModel: vi.fn(() => model),
      complete,
    }));

    const result = await adapter.call({
      provider: 'openai-codex',
      resultProvider: 'openai-codex',
      model: 'gpt-5.3-codex',
      apiKey: 'oauth-token',
      task: {
        stage: 'clip-analysis',
        systemPrompt: 'system',
        userPrompt: 'user',
        maxTokens: 500,
        temperature: 0.2,
      },
    });

    expect(complete).toHaveBeenCalledWith(
      model,
      {
        systemPrompt: 'system',
        messages: [{ role: 'user', content: 'user', timestamp: expect.any(Number) }],
      },
      { apiKey: 'oauth-token' },
    );
    expect(result).toEqual({
      provider: 'openai-codex',
      model: 'gpt-5.3-codex',
      content: '{"clips":[]}\n',
      usage: { inputTokens: 12, outputTokens: 4 },
    });
  });

  it('throws provider error without leaking token', async () => {
    const adapter = new PiProviderAdapter(async () => ({
      getModel: () => ({ provider: 'anthropic', id: 'claude-sonnet-4-6' }),
      complete: async () => ({
        content: [],
        usage: { input: 0, output: 0 },
        stopReason: 'error',
        errorMessage: 'subscription unavailable',
      }),
    }));

    await expect(
      adapter.call({
        provider: 'anthropic',
        resultProvider: 'anthropic-subscription',
        model: 'claude-sonnet-4-6',
        apiKey: 'secret-token',
        task: {
          stage: 'clip-analysis',
          systemPrompt: 'system',
          userPrompt: 'user',
        },
      }),
    ).rejects.toThrow('subscription unavailable');
  });

  it('builds an openai-compatible model for custom baseURL and skips getModel', async () => {
    const getModel = vi.fn(() => {
      throw new Error('getModel should not be called for custom endpoints');
    });
    const complete = vi.fn(async () => ({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input: 2, output: 3 },
      stopReason: 'stop',
    }));
    const adapter = new PiProviderAdapter(async () => ({
      getModel,
      complete,
    }));

    const result = await adapter.call({
      provider: 'custom',
      resultProvider: 'custom:custom',
      model: 'llama-3.1-8b',
      apiKey: 'sk-local',
      baseURL: 'http://192.168.0.10:11434/v1',
      task: {
        stage: 'clip-analysis',
        systemPrompt: 'system',
        userPrompt: 'user',
      },
    });

    expect(getModel).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'custom',
        baseUrl: 'http://192.168.0.10:11434/v1',
        api: 'openai-completions',
      }),
      expect.objectContaining({ systemPrompt: 'system' }),
      { apiKey: 'sk-local' },
    );
    expect(result).toEqual({
      provider: 'custom:custom',
      model: 'llama-3.1-8b',
      content: 'ok',
      usage: { inputTokens: 2, outputTokens: 3 },
    });
  });

  it('uses getModel for pi-ai-registered providers such as openrouter', async () => {
    const getModel = vi.fn(() => ({
      id: 'anthropic/claude-3.5-sonnet',
      provider: 'openrouter',
    }));
    const complete = vi.fn(async () => ({
      content: [{ type: 'text', text: 'reply' }],
      usage: { input: 1, output: 1 },
      stopReason: 'stop',
    }));
    const adapter = new PiProviderAdapter(async () => ({
      getModel,
      complete,
    }));

    await adapter.call({
      provider: 'openrouter',
      resultProvider: 'openrouter',
      model: 'anthropic/claude-3.5-sonnet',
      apiKey: 'sk-or',
      task: {
        stage: 'clip-analysis',
        systemPrompt: 'system',
        userPrompt: 'user',
      },
    });

    expect(getModel).toHaveBeenCalledWith('openrouter', 'anthropic/claude-3.5-sonnet');
  });
});
