import * as Linking from 'expo-linking';
import { supabase } from '../services/supabase';

type AuthCallbackParams = {
  accessToken?: string;
  refreshToken?: string;
  code?: string;
  error?: string;
  errorDescription?: string;
};

export function createAuthRedirectUri() {
  return Linking.createURL('auth/callback');
}

export function parseAuthCallbackParams(url: string): AuthCallbackParams {
  const params = new URLSearchParams();
  const queryIndex = url.indexOf('?');
  const hashIndex = url.indexOf('#');

  if (queryIndex >= 0) {
    const queryEnd = hashIndex > queryIndex ? hashIndex : undefined;
    appendParams(params, url.slice(queryIndex + 1, queryEnd));
  }

  if (hashIndex >= 0) {
    appendParams(params, url.slice(hashIndex + 1));
  }

  return {
    accessToken: params.get('access_token') ?? undefined,
    refreshToken: params.get('refresh_token') ?? undefined,
    code: params.get('code') ?? undefined,
    error: params.get('error') ?? params.get('error_code') ?? undefined,
    errorDescription:
      params.get('error_description') ?? params.get('error_message') ?? undefined,
  };
}

export async function completeAuthCallback(url: string) {
  const params = parseAuthCallbackParams(url);

  if (params.error) {
    throw new Error(params.errorDescription ?? params.error);
  }

  if (params.code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (error) throw error;
    return data.session;
  }

  if (params.accessToken && params.refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: params.accessToken,
      refresh_token: params.refreshToken,
    });
    if (error) throw error;
    return data.session;
  }

  throw new Error('Auth callback missing session tokens.');
}

function appendParams(params: URLSearchParams, raw: string) {
  if (!raw) return;

  const parsed = new URLSearchParams(raw);
  parsed.forEach((value, key) => {
    params.set(key, value);
  });
}
