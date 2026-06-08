import { describe, expect, it, vi } from 'vitest';
import {
  ProviderManager,
  ProviderResult,
  StageTask,
} from './provider-manager';

const task: StageTask = {
  stage: 'clip-analysis',
  systemPrompt: 'system',
  userPrompt: 'user',
};

function result(provider: ProviderResult['provider']): ProviderResult {
  return {
    provider,
    model: 'model',
    content: '{"clips":[]}',
    usage: { inputTokens: 1, outputTokens: 1 },
  };
}

describe('ProviderManager subscription selection', () => {
  it('uses Codex OAuth when selected', async () => {
    const oauthCredentialsStore = {
      getApiKey: vi.fn(async () => 'codex-token'),
    };
    const piAdapter = {
      call: vi.fn(async () => result('openai-codex')),
    };
    const openAiCaller = vi.fn(async () => result('openai'));
    const manager = new ProviderManager({
      env: { HANDCLIP_LLM_PROVIDER: 'openai-codex' },
      oauthCredentialsStore,
      piAdapter,
      openAiCaller,
    });

    await expect(manager.callWithFallback(task)).resolves.toEqual(result('openai-codex'));
    expect(oauthCredentialsStore.getApiKey).toHaveBeenCalledWith('openai-codex');
    expect(piAdapter.call).toHaveBeenCalledWith({
      provider: 'openai-codex',
      resultProvider: 'openai-codex',
      model: 'gpt-5.3-codex',
      apiKey: 'codex-token',
      task,
    });
    expect(openAiCaller).not.toHaveBeenCalled();
  });

  it('uses Claude subscription OAuth when selected', async () => {
    const oauthCredentialsStore = {
      getApiKey: vi.fn(async () => 'claude-token'),
    };
    const piAdapter = {
      call: vi.fn(async () => result('anthropic-subscription')),
    };
    const manager = new ProviderManager({
      env: { HANDCLIP_LLM_PROVIDER: 'anthropic-subscription' },
      oauthCredentialsStore,
      piAdapter,
      openAiCaller: vi.fn(),
    });

    await expect(manager.callWithFallback(task)).resolves.toEqual(result('anthropic-subscription'));
    expect(oauthCredentialsStore.getApiKey).toHaveBeenCalledWith('anthropic');
    expect(piAdapter.call).toHaveBeenCalledWith({
      provider: 'anthropic',
      resultProvider: 'anthropic-subscription',
      model: 'claude-sonnet-4-6',
      apiKey: 'claude-token',
      task,
    });
  });

  it('uses configured Codex model from manager environment', async () => {
    const piAdapter = {
      call: vi.fn(async () => result('openai-codex')),
    };
    const manager = new ProviderManager({
      env: {
        HANDCLIP_LLM_PROVIDER: 'openai-codex',
        HANDCLIP_CODEX_MODEL: 'gpt-5.3-codex-spark',
      },
      oauthCredentialsStore: { getApiKey: vi.fn(async () => 'codex-token') },
      piAdapter,
      openAiCaller: vi.fn(),
    });

    await manager.callWithFallback(task);

    expect(piAdapter.call).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5.3-codex-spark' }),
    );
  });

  it('falls back to API-key provider when OAuth credentials are missing', async () => {
    const openAiCaller = vi.fn(async () => result('openai'));
    const manager = new ProviderManager({
      env: {
        HANDCLIP_LLM_PROVIDER: 'openai-codex',
        HANDCLIP_LLM_ALLOW_API_KEY_FALLBACK: 'true',
        OPENAI_API_KEY: 'openai-key',
      },
      oauthCredentialsStore: { getApiKey: vi.fn(async () => null) },
      piAdapter: { call: vi.fn() },
      openAiCaller,
    });

    await expect(manager.callWithFallback(task)).resolves.toEqual(result('openai'));
    expect(openAiCaller).toHaveBeenCalledOnce();
  });

  it('fails when OAuth credentials are missing and fallback is disabled', async () => {
    const openAiCaller = vi.fn();
    const manager = new ProviderManager({
      env: {
        HANDCLIP_LLM_PROVIDER: 'openai-codex',
        HANDCLIP_LLM_ALLOW_API_KEY_FALLBACK: 'false',
        OPENAI_API_KEY: 'openai-key',
      },
      oauthCredentialsStore: { getApiKey: vi.fn(async () => null) },
      piAdapter: { call: vi.fn() },
      openAiCaller,
    });

    await expect(manager.callWithFallback(task)).rejects.toThrow(
      'No OAuth credentials found for openai-codex',
    );
    expect(openAiCaller).not.toHaveBeenCalled();
  });

  it('uses pi-ai for Anthropic API-key provider', async () => {
    const piAdapter = {
      call: vi.fn(async () => result('anthropic')),
    };
    const openAiCaller = vi.fn();
    const manager = new ProviderManager({
      env: {
        HANDCLIP_LLM_PROVIDER: 'api-key',
        ANTHROPIC_API_KEY: 'anthropic-key',
      },
      oauthCredentialsStore: { getApiKey: vi.fn() },
      piAdapter,
      openAiCaller,
    });

    await expect(manager.callWithFallback(task)).resolves.toEqual(result('anthropic'));
    expect(piAdapter.call).toHaveBeenCalledWith({
      provider: 'anthropic',
      resultProvider: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: 'anthropic-key',
      task,
    });
    expect(openAiCaller).not.toHaveBeenCalled();
  });

  it('rejects an invalid provider selection at startup', () => {
    expect(
      () =>
        new ProviderManager({
          env: { HANDCLIP_LLM_PROVIDER: 'random-provider' },
        }),
    ).toThrow('Invalid HANDCLIP_LLM_PROVIDER: random-provider');
  });

  it('uses the user-specific active OAuth provider when requested', async () => {
    const databaseStore = {
      getActiveApiKey: vi.fn(async () => ({
        type: 'oauth' as const,
        apiKey: 'user-token',
        provider: 'openai-codex' as const,
        resultProvider: 'openai-codex' as const,
      })),
    };
    const piAdapter = { call: vi.fn(async () => result('openai-codex')) };
    const manager = new ProviderManager({
      env: { HANDCLIP_LLM_PROVIDER: 'api-key' },
      databaseConnectionStore: databaseStore,
      piAdapter,
      openAiCaller: vi.fn(),
    });

    await expect(manager.callWithUserProvider(task, 'user-1')).resolves.toEqual(
      result('openai-codex'),
    );
    expect(databaseStore.getActiveApiKey).toHaveBeenCalledWith('user-1');
    expect(piAdapter.call).toHaveBeenCalledWith({
      provider: 'openai-codex',
      resultProvider: 'openai-codex',
      model: 'gpt-5.3-codex',
      apiKey: 'user-token',
      task,
    });
  });

  it('routes the user-specific API-key connection through pi-ai with model and base URL', async () => {
    const databaseStore: { getActiveApiKey: ReturnType<typeof vi.fn> } = {
      getActiveApiKey: vi.fn(async () => ({
        type: 'api-key' as const,
        apiKey: 'sk-user',
        provider: 'openrouter' as const,
        model: 'anthropic/claude-3.5-sonnet',
        baseUrl: null,
        resultProvider: 'openrouter',
      })),
    };
    const piAdapter = { call: vi.fn(async () => result('openrouter')) };
    const manager = new ProviderManager({
      env: { HANDCLIP_LLM_PROVIDER: 'api-key' },
      databaseConnectionStore: databaseStore,
      piAdapter,
      openAiCaller: vi.fn(),
    });

    await expect(manager.callWithUserProvider(task, 'user-1')).resolves.toEqual(
      result('openrouter'),
    );
    expect(piAdapter.call).toHaveBeenCalledWith({
      provider: 'openrouter',
      resultProvider: 'openrouter',
      model: 'anthropic/claude-3.5-sonnet',
      apiKey: 'sk-user',
      task,
    });
  });

  it('forwards base URL to pi-ai for custom openai-compatible endpoints', async () => {
    const databaseStore: { getActiveApiKey: ReturnType<typeof vi.fn> } = {
      getActiveApiKey: vi.fn(async () => ({
        type: 'api-key' as const,
        apiKey: 'sk-local',
        provider: 'custom' as const,
        model: 'llama-3.1-8b',
        baseUrl: 'http://192.168.0.10:11434/v1',
        resultProvider: 'custom',
      })),
    };
    const piAdapter = { call: vi.fn(async () => result('custom')) };
    const manager = new ProviderManager({
      env: { HANDCLIP_LLM_PROVIDER: 'api-key' },
      databaseConnectionStore: databaseStore,
      piAdapter,
      openAiCaller: vi.fn(),
    });

    await expect(manager.callWithUserProvider(task, 'user-1')).resolves.toEqual(
      result('custom'),
    );
    expect(piAdapter.call).toHaveBeenCalledWith({
      provider: 'custom',
      resultProvider: 'custom',
      model: 'llama-3.1-8b',
      apiKey: 'sk-local',
      baseURL: 'http://192.168.0.10:11434/v1',
      task,
    });
  });

  it('throws when no active OAuth connection exists for the user', async () => {
    const databaseStore = {
      getActiveApiKey: vi.fn(async () => null),
    };
    const manager = new ProviderManager({
      env: {},
      databaseConnectionStore: databaseStore,
      piAdapter: { call: vi.fn() },
      openAiCaller: vi.fn(),
    });

    await expect(manager.callWithUserProvider(task, 'user-1')).rejects.toThrow(
      'No active AI connection found for user',
    );
  });
});
