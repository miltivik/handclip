import { useEffect } from 'react';
import * as Google from 'expo-auth-session/providers/google';
import { signInWithGoogleIdToken } from '../services/supabase';

// ponytail: hook wrapper. expo-auth-session opens Google consent, returns id_token;
// Supabase then issues a session and onAuthStateChange in the auth store picks it up.
// Setup (one-time, outside the repo):
//   1. Google Cloud Console → APIs & Services → Credentials → Create OAuth client IDs
//      for iOS and Android (use bundle IDs from app.json: com.handclip.app).
//   2. Supabase dashboard → Authentication → Providers → enable Google, paste the
//      Web client ID (used for Supabase's token verification — create it too).
//   3. Put the iOS/Android client IDs in handclip-app/.env (EXPO_PUBLIC_GOOGLE_*).
export function useGoogleAuth() {
  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  });

  useEffect(() => {
    if (response?.type !== 'success') {
      if (response?.type === 'error') {
        console.warn('[GoogleAuth] auth error:', response.error);
      }
      return;
    }
    const idToken = response.params.id_token;
    if (!idToken) return;
    signInWithGoogleIdToken(idToken).catch((err) => {
      console.warn('[GoogleAuth] signInWithIdToken failed:', err?.message);
    });
  }, [response]);

  return promptAsync;
}
