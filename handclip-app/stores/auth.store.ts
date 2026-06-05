import { create } from 'zustand';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';
import { completeAuthCallback, createAuthRedirectUri } from '../lib/auth-callback';

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  isAnonymous: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithMagicLink: (email: string) => Promise<{ success: boolean }>;
  signOut: () => Promise<void>;
  continueAnonymously: () => void;
  loadSession: () => Promise<void>;
  initAuth: () => () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  loading: true,
  isAuthenticated: false,
  isAnonymous: false,

  signUp: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    set({ session: data.session, user: data.user, isAuthenticated: !!data.session, isAnonymous: false });
  },

  signIn: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    set({ session: data.session, user: data.user, isAuthenticated: true, isAnonymous: false });
  },

  signInWithGoogle: async () => {
    const redirectTo = createAuthRedirectUri();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });
    if (error) throw error;
    // OAuth flow returns a URL to open; callback result carries session data.
    if (data?.url) {
      const { openAuthSessionAsync } = await import('expo-web-browser');
      const result = await openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== 'success') throw new Error('Google sign in cancelled');
      await completeAuthCallback(result.url);
    }
  },

  signInWithMagicLink: async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: createAuthRedirectUri(),
      },
    });
    if (error) throw error;
    return { success: true };
  },

  signOut: async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    set({ session: null, user: null, isAuthenticated: false, isAnonymous: false });
  },
  continueAnonymously: () => {
    if (__DEV__) {
      set({ session: null, user: null, loading: false, isAuthenticated: false, isAnonymous: true });
    }
  },
  loadSession: async () => {
    set({ loading: true });
    const { data: { session } } = await supabase.auth.getSession();
    set({ 
      session, 
      user: session?.user ?? null,
      loading: false,
      isAuthenticated: !!session,
      isAnonymous: false,
    });
  },

  initAuth: () => {
    // Cargar sesión existente al iniciar
    supabase.auth.getSession().then(({ data: { session } }) => {
      set({
        session,
        user: session?.user ?? null,
        loading: false,
        isAuthenticated: !!session,
        isAnonymous: false,
      });
    });

    // Escuchar cambios de auth (login, logout, refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session) {
          set({ session, user: session.user, loading: false, isAuthenticated: true, isAnonymous: false });
        } else {
          set((state) => ({
            session: null,
            user: null,
            loading: false,
            isAuthenticated: false,
            isAnonymous: state.isAnonymous,
          }));
        }
      }
    );

    return () => subscription.unsubscribe();
  },
}));
