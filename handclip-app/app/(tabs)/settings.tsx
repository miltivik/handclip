import { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '../../stores/auth.store';
import { ThemePreference, useAppTheme } from '../../lib/theme';

const THEME_OPTIONS: { value: ThemePreference; label: string; accessibilityLabel: string }[] = [
  { value: 'system', label: 'Sistema', accessibilityLabel: 'Tema sistema' },
  { value: 'light', label: 'Claro', accessibilityLabel: 'Tema claro' },
  { value: 'dark', label: 'Oscuro', accessibilityLabel: 'Tema oscuro' },
];

export default function SettingsTab() {
  const {
    theme,
    themePreference,
    setThemePreference,
    colorScheme,
  } = useAppTheme();
  const user = useAuthStore((state) => state.user);
  const isAnonymous = useAuthStore((state) => state.isAnonymous);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const signOut = useAuthStore((state) => state.signOut);
  const canUsePrivateApi = isAuthenticated && !isAnonymous;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSignOut = async () => {
    setLoading(true);
    setError('');
    try {
      await signOut();
      router.replace('/login');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cerrar sesión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
    >
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Apariencia</Text>
        <View
          style={[styles.segmented, { backgroundColor: theme.surface, borderColor: theme.border }]}
        >
          {THEME_OPTIONS.map((option) => {
            const selected = themePreference === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.segmentButton,
                  selected && { backgroundColor: theme.primary },
                ]}
                onPress={() => setThemePreference(option.value)}
                accessibilityLabel={option.accessibilityLabel}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text
                  style={[
                    styles.segmentText,
                    { color: selected ? theme.primaryText : theme.text },
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={[styles.helperText, { color: theme.muted }]}>
          Tema activo: {colorScheme === 'dark' ? 'Oscuro' : 'Claro'}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Cuenta</Text>
        {error ? (
          <View
            style={[styles.errorCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
            accessibilityRole="alert"
          >
            <Text style={[styles.errorText, { color: theme.danger }]}>{error}</Text>
          </View>
        ) : null}
        <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>
            {canUsePrivateApi ? 'Cuenta conectada' : 'Modo exploración'}
          </Text>
          <Text style={[styles.cardBody, { color: theme.muted }]}>
            {canUsePrivateApi
              ? user?.email ?? 'Sesión activa'
              : 'Inicia sesión para guardar proyectos, exportaciones y conexiones IA.'}
          </Text>
          {canUsePrivateApi ? (
            <TouchableOpacity
              style={[styles.outlineButton, { borderColor: theme.border }]}
              onPress={handleSignOut}
              disabled={loading}
              accessibilityLabel="Cerrar sesión"
              accessibilityRole="button"
            >
              <Text style={[styles.outlineButtonText, { color: theme.text }]}>
                {loading ? 'Cerrando…' : 'Cerrar sesión'}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.button, { backgroundColor: theme.primary }]}
              onPress={() => router.push('/login')}
              accessibilityLabel="Crear cuenta o iniciar sesión"
              accessibilityRole="button"
            >
              <Text style={[styles.buttonText, { color: theme.primaryText }]}>
                Crear cuenta o iniciar sesión
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 10 },
  segmented: {
    flexDirection: 'row',
    borderRadius: 8,
    borderWidth: 1,
    padding: 4,
    gap: 4,
  },
  segmentButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  segmentText: { fontSize: 14, fontWeight: '700' },
  panel: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  cardBody: { fontSize: 14, marginTop: 6, lineHeight: 20 },
  helperText: { fontSize: 12, marginTop: 8 },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  outlineButton: {
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonText: { fontSize: 14, fontWeight: '700' },
  outlineButtonText: { fontSize: 14, fontWeight: '700' },
  errorCard: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
  },
  errorText: { fontSize: 14 },
});
