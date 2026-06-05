import { supabase } from '../services/supabase';
import { safeStorage } from './safe-storage';

const ONBOARDING_STORAGE_KEY = 'handclip.hasSeenOnboarding';

export async function getHasSeenOnboarding(): Promise<boolean> {
  const localSeen = await safeStorage.getItem(ONBOARDING_STORAGE_KEY);
  if (localSeen === 'true') return true;

  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.user_metadata?.hasSeenOnboarding === true;
  } catch {
    return false;
  }
}

export async function markOnboardingSeen(): Promise<{ isAuthenticated: boolean }> {
  await safeStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');

  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return { isAuthenticated: false };

    try {
      await supabase.auth.updateUser({
        data: { hasSeenOnboarding: true },
      });
    } catch {
      // Local onboarding state still lets this device continue.
    }

    return { isAuthenticated: true };
  } catch {
    return { isAuthenticated: false };
  }
}
