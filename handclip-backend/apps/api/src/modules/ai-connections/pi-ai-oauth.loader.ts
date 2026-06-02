export interface PiAiOAuthLoginModule {
  loginOpenAICodexDeviceCode(options: {
    onDeviceCode: (info: {
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresInSeconds?: number;
    }) => void;
  }): Promise<{ access: string; refresh: string; expires: number; [key: string]: unknown }>;
  loginAnthropic(options: {
    onAuth: (info: { url: string; instructions?: string }) => void;
    onPrompt: (prompt: { message: string }) => Promise<string>;
    onManualCodeInput: () => Promise<string>;
  }): Promise<{ access: string; refresh: string; expires: number; [key: string]: unknown }>;
}

const nativeImport = new Function('specifier', 'return import(specifier)') as <T>(
  specifier: string,
) => Promise<T>;

export const loadPiAiOAuth = (): Promise<PiAiOAuthLoginModule> =>
  nativeImport<PiAiOAuthLoginModule>('@earendil-works/pi-ai/oauth');
