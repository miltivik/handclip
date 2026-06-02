import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { dirname } from 'path';

export interface OAuthCredentials {
  type?: 'oauth';
  access: string;
  refresh: string;
  expires: number;
  [key: string]: unknown;
}

export type OAuthCredentialsMap = Record<string, OAuthCredentials>;

export interface OAuthApiKeyResult {
  apiKey: string;
  newCredentials: OAuthCredentials;
}

export type OAuthApiKeyResolver = (
  provider: string,
  credentials: OAuthCredentialsMap,
) => Promise<OAuthApiKeyResult | null>;

export class OAuthCredentialsStore {
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly resolveApiKey: OAuthApiKeyResolver,
  ) {}

  async getApiKey(provider: string): Promise<string | null> {
    return this.withLock(async () => {
      const credentials = await this.readCredentials();
      if (!credentials[provider]) {
        return null;
      }

      const result = await this.resolveApiKey(provider, credentials);
      if (!result) {
        return null;
      }

      credentials[provider] = {
        type: 'oauth',
        ...result.newCredentials,
      };
      await this.writeCredentials(credentials);
      return result.apiKey;
    });
  }

  private async readCredentials(): Promise<OAuthCredentialsMap> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as OAuthCredentialsMap;
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  private async writeCredentials(credentials: OAuthCredentialsMap): Promise<void> {
    const temporaryPath = `${this.filePath}.tmp`;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(credentials, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.filePath);
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pendingWrite.then(operation, operation);
    this.pendingWrite = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
