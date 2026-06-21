import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// ponytail: SecureStore is async; supabase's storage adapter accepts promises.
const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // native: handled manually via Linking
  },
});

// Hand off OAuth/magic-link deep links to supabase-js to exchange for a session.
// Called from app/_layout.tsx when Linking fires.
export async function handleAuthUrl(url: string) {
  const { data, error } = await supabase.auth.exchangeCodeForSession(url);
  if (error) console.warn('[Auth] exchangeCodeForSession failed:', error.message);
  return { data, error };
}

export default supabase;
