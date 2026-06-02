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
});
