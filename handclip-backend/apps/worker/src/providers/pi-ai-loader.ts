export interface PiAiTextContent {
  type: string;
  text?: string;
}

export interface PiAiResponse {
  content: PiAiTextContent[];
  usage: { input: number; output: number };
  stopReason: string;
  errorMessage?: string;
}

export interface PiAiModule {
  getModel: (provider: string, model: string) => unknown;
  complete: (
    model: unknown,
    context: {
      systemPrompt?: string;
      messages: Array<{ role: 'user'; content: string; timestamp: number }>;
    },
    options: { apiKey: string },
  ) => Promise<PiAiResponse>;
}

export interface PiAiOAuthModule {
  getOAuthApiKey: (
    provider: string,
    credentials: Record<string, { access: string; refresh: string; expires: number; [key: string]: unknown }>,
  ) => Promise<{
    apiKey: string;
    newCredentials: {
      access: string;
      refresh: string;
      expires: number;
      [key: string]: unknown;
    };
  } | null>;
}

type NativeImport = <T>(specifier: string) => Promise<T>;

// Keep native import() intact when Nest compiles the worker to CommonJS.
const nativeImport = new Function('specifier', 'return import(specifier)') as NativeImport;

export const loadPiAi = (): Promise<PiAiModule> =>
  nativeImport<PiAiModule>('@earendil-works/pi-ai');

export const loadPiAiOAuth = (): Promise<PiAiOAuthModule> =>
  nativeImport<PiAiOAuthModule>('@earendil-works/pi-ai/oauth');
