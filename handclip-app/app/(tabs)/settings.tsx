import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import {
  AiConnection,
  AiProvider,
  api,
  OAuthAttempt,
} from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';
import { ThemePreference, useAppTheme } from '../../lib/theme';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const PROVIDER_LABELS: Record<AiProvider, { title: string; description: string; warn?: string }> = {
  'openai-codex': {
    title: 'ChatGPT Plus/Pro (Codex)',
    description: 'Conecta tu cuenta ChatGPT Plus o Pro para usar Codex.',
  },
  anthropic: {
    title: 'Anthropic Claude Pro/Max',
    description: 'Conecta tu suscripción Claude Pro o Max.',
    warn: 'El uso desde integraciones de terceros puede consumir extra usage facturado.',
  },
};

const THEME_OPTIONS: { value: ThemePreference; label: string; accessibilityLabel: string }[] = [
  { value: 'system', label: 'Sistema', accessibilityLabel: 'Tema sistema' },
  { value: 'light', label: 'Claro', accessibilityLabel: 'Tema claro' },
  { value: 'dark', label: 'Oscuro', accessibilityLabel: 'Tema oscuro' },
];

const TERMINAL_STATUSES: OAuthAttempt['status'][] = ['connected', 'failed', 'expired', 'cancelled'];

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
  const [connections, setConnections] = useState<AiConnection[]>([]);
  const [attempt, setAttempt] = useState<OAuthAttempt | null>(null);
  const [manualInput, setManualInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [quota, setQuota] = useState<{ exportsThisMonth: number; maxExports: number; plan: string } | null>(null);
  const [quotaError, setQuotaError] = useState(false);

  const refresh = async () => {
    if (!canUsePrivateApi) {
      setConnections([]);
      return;
    }
    try {
      const data = await api.getAiConnections();
      setConnections(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las conexiones');
    }
  };

  useEffect(() => {
    if (canUsePrivateApi) {
      refresh();
      return;
    }
    setConnections([]);
    setAttempt(null);
    setError('');
  }, [canUsePrivateApi]);

  useEffect(() => {
    if (!canUsePrivateApi) {
      setQuota(null);
      setQuotaError(false);
      return;
    }
    setQuotaError(false);
    api.getQuota().then(setQuota).catch(() => setQuotaError(true));
  }, [canUsePrivateApi]);

  const waitFor = async (
    provider: AiProvider,
    id: string,
    wanted: OAuthAttempt['status'][],
  ): Promise<OAuthAttempt> => {
    for (let count = 0; count < 120; count++) {
      const next = await api.getAiConnectionAttempt(provider, id);
      setAttempt(next);
      if (wanted.includes(next.status) || TERMINAL_STATUSES.includes(next.status)) {
        return next;
      }
      await sleep(1000);
    }
    throw new Error('Tiempo de espera agotado para el intento OAuth');
  };

  const connectCodex = async (provider: AiProvider) => {
    if (!canUsePrivateApi) {
      router.push('/login');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const started = await api.startAiConnection(provider);
      setAttempt(started);
      const ready = await waitFor(provider, started.id, ['awaiting-user']);
      const url = ready.verificationUri || ready.authorizationUrl;
      if (url) {
        await WebBrowser.openBrowserAsync(url);
      }
      const done = await waitFor(provider, started.id, ['connected']);
      if (done.status !== 'connected') {
        throw new Error(done.error || 'Conexión cancelada o fallida');
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo conectar');
    } finally {
      setLoading(false);
    }
  };

  const submitAnthropic = async () => {
    if (!attempt || attempt.provider !== 'anthropic') return;
    if (!manualInput.trim()) {
      setError('Pega el código o la URL final');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.submitAiConnectionInput('anthropic', attempt.id, manualInput);
      const done = await waitFor('anthropic', attempt.id, ['connected']);
      if (done.status !== 'connected') {
        throw new Error(done.error || 'Conexión cancelada o fallida');
      }
      setManualInput('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo conectar');
    } finally {
      setLoading(false);
    }
  };

  const connectAnthropic = async (provider: AiProvider) => {
    if (!canUsePrivateApi) {
      router.push('/login');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const started = await api.startAiConnection(provider);
      setAttempt(started);
      const ready = await waitFor(provider, started.id, ['awaiting-user']);
      if (ready.authorizationUrl) {
        await WebBrowser.openBrowserAsync(ready.authorizationUrl);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo conectar');
    } finally {
      setLoading(false);
    }
  };

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
        <View style={[styles.segmented, { backgroundColor: theme.surface, borderColor: theme.border }]}>
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
              accessibilityLabel="Cerrar sesión"
              accessibilityRole="button"
            >
              <Text style={[styles.outlineButtonText, { color: theme.text }]}>Cerrar sesión</Text>
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

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Uso</Text>
        {canUsePrivateApi ? (
          quota ? (
            <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Cuota de exportaciones</Text>
              <Text
                style={[
                  styles.cardBody,
                  { color: quota.exportsThisMonth >= quota.maxExports ? theme.danger : theme.muted },
                ]}
              >
                Exports este mes: {quota.exportsThisMonth} / {quota.maxExports}
              </Text>
              {quota.exportsThisMonth >= quota.maxExports ? (
                <Text style={[styles.warn, { color: theme.danger }]}>Límite alcanzado</Text>
              ) : (
                <Text style={[styles.warn, { color: theme.success }]}>
                  {quota.maxExports - quota.exportsThisMonth} restantes
                </Text>
              )}
              <Text style={[styles.helperText, { color: theme.muted }]}>Plan: {quota.plan}</Text>
            </View>
          ) : quotaError ? (
            <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.cardBody, { color: theme.muted }]}>
                No se pudo cargar tu cuota actual.
              </Text>
            </View>
          ) : (
            <ActivityIndicator
              accessibilityLabel="Cargando cuota"
              color={theme.primary}
              style={styles.sectionLoader}
            />
          )
        ) : (
          <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.cardBody, { color: theme.muted }]}>
              La cuota aparece cuando inicias sesión.
            </Text>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>IA</Text>
        {!canUsePrivateApi ? (
          <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>Conexiones privadas</Text>
            <Text style={[styles.cardBody, { color: theme.muted }]}>
              Necesitas una cuenta para conectar Codex o Anthropic y usar el análisis IA.
            </Text>
            <TouchableOpacity
              style={[styles.button, { backgroundColor: theme.primary }]}
              onPress={() => router.push('/login')}
              accessibilityLabel="Iniciar sesión para conectar IA"
              accessibilityRole="button"
            >
              <Text style={[styles.buttonText, { color: theme.primaryText }]}>Iniciar sesión</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {error ? (
              <View
                style={[styles.errorCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
                accessibilityRole="alert"
              >
                <Text style={[styles.errorText, { color: theme.danger }]}>{error}</Text>
              </View>
            ) : null}
            {loading ? (
              <ActivityIndicator accessibilityLabel="Procesando conexión" color={theme.primary} />
            ) : null}
            {(['openai-codex', 'anthropic'] as AiProvider[]).map((provider) => {
              const connection = connections.find((c) => c.provider === provider);
              const meta = PROVIDER_LABELS[provider];
              return (
                <View
                  key={provider}
                  style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}
                >
                  <Text style={[styles.cardTitle, { color: theme.text }]}>{meta.title}</Text>
                  <Text style={[styles.cardBody, { color: theme.muted }]}>{meta.description}</Text>
                  {meta.warn ? <Text style={[styles.warn, { color: theme.warning }]}>{meta.warn}</Text> : null}
                  <Text style={[styles.status, { color: theme.primary }]}>
                    {connection
                      ? connection.isActive
                        ? 'Activo'
                        : 'Conectado'
                      : 'Desconectado'}
                  </Text>
                  {!connection ? (
                    <TouchableOpacity
                      style={[
                        styles.button,
                        { backgroundColor: theme.primary },
                        (loading ||
                          (attempt?.provider === provider &&
                            !TERMINAL_STATUSES.includes(attempt.status))) &&
                          styles.buttonDisabled,
                      ]}
                      disabled={
                        loading ||
                        (attempt?.provider === provider &&
                          !TERMINAL_STATUSES.includes(attempt.status))
                      }
                      onPress={() =>
                        provider === 'openai-codex'
                          ? connectCodex(provider)
                          : connectAnthropic(provider)
                      }
                      accessibilityLabel={`Conectar ${meta.title}`}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.buttonText, { color: theme.primaryText }]}>Conectar</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.row}>
                      {!connection.isActive ? (
                        <TouchableOpacity
                          style={[styles.flexButton, { backgroundColor: theme.text }]}
                          onPress={async () => {
                            try {
                              await api.setActiveAiConnection(provider);
                              await refresh();
                            } catch (e) {
                              setError(e instanceof Error ? e.message : 'No se pudo activar');
                            }
                          }}
                          accessibilityLabel={`Usar ${meta.title} para análisis`}
                          accessibilityRole="button"
                        >
                          <Text style={[styles.buttonText, { color: theme.background }]}>
                            Usar para análisis
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                      <TouchableOpacity
                        style={[styles.flexButton, { backgroundColor: theme.danger }]}
                        onPress={async () => {
                          try {
                            await api.disconnectAiConnection(provider);
                            await refresh();
                          } catch (e) {
                            setError(
                              e instanceof Error ? e.message : 'No se pudo desconectar',
                            );
                          }
                        }}
                        accessibilityLabel={`Desconectar ${meta.title}`}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.buttonText, { color: theme.background }]}>Desconectar</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}

            {attempt?.provider === 'openai-codex' && attempt.userCode ? (
              <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>Código de verificación</Text>
                <Text style={[styles.codeText, { color: theme.text }]}>{attempt.userCode}</Text>
                <Text style={[styles.cardBody, { color: theme.muted }]}>
                  Abre {attempt.verificationUri} en tu navegador e ingresa el código.
                </Text>
              </View>
            ) : null}

            {attempt?.provider === 'anthropic' && attempt.status === 'awaiting-user' ? (
              <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>Pega el código o URL final</Text>
                <TextInput
                  style={[
                    styles.input,
                    { backgroundColor: theme.surfaceElevated, borderColor: theme.border, color: theme.text },
                  ]}
                  value={manualInput}
                  onChangeText={setManualInput}
                  placeholder="code#state o URL completa"
                  placeholderTextColor={theme.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Código de autorización"
                />
                <TouchableOpacity
                  style={[styles.button, { backgroundColor: theme.primary }]}
                  onPress={submitAnthropic}
                  accessibilityLabel="Confirmar código"
                  accessibilityRole="button"
                >
                  <Text style={[styles.buttonText, { color: theme.primaryText }]}>Confirmar código</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
  },
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
  segmentText: {
    fontSize: 14,
    fontWeight: '700',
  },
  panel: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  cardBody: {
    fontSize: 14,
    marginTop: 6,
    lineHeight: 20,
  },
  helperText: {
    fontSize: 12,
    marginTop: 8,
  },
  warn: {
    fontSize: 12,
    marginTop: 6,
    fontWeight: '600',
  },
  status: {
    fontSize: 12,
    marginTop: 8,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  flexButton: {
    flex: 1,
    minWidth: 140,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
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
  buttonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  outlineButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  sectionLoader: {
    marginVertical: 12,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    marginTop: 8,
  },
  codeText: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 8,
    letterSpacing: 2,
  },
  errorCard: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 14,
  },
});
