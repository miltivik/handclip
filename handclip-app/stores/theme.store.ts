import { create } from 'zustand';
import type * as ZustandMiddleware from 'zustand/middleware';
import type { ThemePreference } from '../lib/theme';
import { safeStorage } from '../lib/safe-storage';

declare const require: <T>(name: string) => T;

const { createJSONStorage, persist } =
  require<typeof ZustandMiddleware>('zustand/middleware');

interface ThemeState {
  themePreference: ThemePreference;
  setThemePreference: (themePreference: ThemePreference) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      themePreference: 'system',
      setThemePreference: (themePreference) => set({ themePreference }),
    }),
    {
      name: 'handclip-theme',
      storage: createJSONStorage(() => safeStorage),
    },
  ),
);
