import { useColorScheme } from 'react-native';
import { useThemeStore } from '../stores/theme.store';

export type ThemePreference = 'light' | 'dark' | 'system';
export type EffectiveTheme = 'light' | 'dark';

export type AppTheme = {
  background: string;
  surface: string;
  surfaceElevated: string;
  text: string;
  muted: string;
  border: string;
  primary: string;
  primaryText: string;
  danger: string;
  success: string;
  warning: string;
  overlay: string;
};

export const lightTheme: AppTheme = {
  background: '#FFFFFF',
  surface: '#F9FAFB',
  surfaceElevated: '#FFFFFF',
  text: '#111827',
  muted: '#6B7280',
  border: '#E5E7EB',
  primary: '#007AFF',
  primaryText: '#FFFFFF',
  danger: '#DC2626',
  success: '#16A34A',
  warning: '#B45309',
  overlay: '#F3F4F6',
};

export const darkTheme: AppTheme = {
  background: '#0F1115',
  surface: '#171A21',
  surfaceElevated: '#20242D',
  text: '#F8FAFC',
  muted: '#A1A8B3',
  border: '#2A2F3A',
  primary: '#4DA3FF',
  primaryText: '#0F1115',
  danger: '#F87171',
  success: '#4ADE80',
  warning: '#FBBF24',
  overlay: '#252A34',
};

export const appThemes: Record<EffectiveTheme, AppTheme> = {
  light: lightTheme,
  dark: darkTheme,
};

export function resolveThemePreference(
  preference: ThemePreference,
  systemScheme: 'light' | 'dark' | null | undefined,
): EffectiveTheme {
  if (preference === 'system') {
    return systemScheme === 'dark' ? 'dark' : 'light';
  }
  return preference;
}

export function useAppTheme() {
  const systemScheme = useColorScheme();
  const themePreference = useThemeStore((state) => state.themePreference);
  const setThemePreference = useThemeStore((state) => state.setThemePreference);
  const colorScheme = resolveThemePreference(themePreference, systemScheme);

  return {
    theme: appThemes[colorScheme],
    themePreference,
    setThemePreference,
    colorScheme,
    isDark: colorScheme === 'dark',
  };
}
