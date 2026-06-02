import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  OAuthCredentials,
  OAuthCredentialsMap,
  OAuthCredentialsStore,
} from './oauth-credentials.store';

const tempDirectories: string[] = [];

async function createTempAuthPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'handclip-oauth-'));
  tempDirectories.push(directory);
  return join(directory, 'auth.json');
}

function credential(access: string): OAuthCredentials {
  return {
    type: 'oauth',
    access,
    refresh: `refresh-${access}`,
    expires: Date.now() + 60_000,
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('OAuthCredentialsStore', () => {
  it('returns null when credentials file does not exist', async () => {
    const authPath = await createTempAuthPath();
    const store = new OAuthCredentialsStore(authPath, async () => null);

    await expect(store.getApiKey('openai-codex')).resolves.toBeNull();
  });

  it('persists refreshed credentials without losing other providers', async () => {
    const authPath = await createTempAuthPath();
    const auth: OAuthCredentialsMap = {
      'openai-codex': credential('old-codex'),
      anthropic: credential('claude'),
    };
    await writeFile(authPath, JSON.stringify(auth));

    const refreshedCodex = credential('new-codex');
    const store = new OAuthCredentialsStore(authPath, async () => ({
      apiKey: 'new-api-key',
      newCredentials: refreshedCodex,
    }));

    await expect(store.getApiKey('openai-codex')).resolves.toBe('new-api-key');

    const persisted = JSON.parse(await readFile(authPath, 'utf8')) as OAuthCredentialsMap;
    expect(persisted['openai-codex']).toEqual(refreshedCodex);
    expect(persisted.anthropic).toEqual(auth.anthropic);
  });

  it('serializes refresh writes so concurrent providers are preserved', async () => {
    const authPath = await createTempAuthPath();
    await writeFile(
      authPath,
      JSON.stringify({
        'openai-codex': credential('old-codex'),
        anthropic: credential('old-claude'),
      }),
    );

    const refreshedCredentials: OAuthCredentialsMap = {};
    const store = new OAuthCredentialsStore(authPath, async (provider) => {
      await new Promise((resolve) => setTimeout(resolve, provider === 'openai-codex' ? 20 : 1));
      refreshedCredentials[provider] = credential(`new-${provider}`);
      return {
        apiKey: `${provider}-api-key`,
        newCredentials: refreshedCredentials[provider],
      };
    });

    await Promise.all([store.getApiKey('openai-codex'), store.getApiKey('anthropic')]);

    const persisted = JSON.parse(await readFile(authPath, 'utf8')) as OAuthCredentialsMap;
    expect(persisted['openai-codex']).toEqual(refreshedCredentials['openai-codex']);
    expect(persisted.anthropic).toEqual(refreshedCredentials.anthropic);
  });
});
