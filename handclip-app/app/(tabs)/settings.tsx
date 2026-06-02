import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const PROVIDER_LABELS: Record<AiProvider, { title: string; description: string; warn?: string }> = {
  'openai-codex': {
    title: 'ChatGPT Plus/Pro (Codex)',
    description: 'Conecta tu cuenta ChatGPT Plus o Pro para usar Codex.',
  },
  anthropic: {
    title: 'Anthropic Claude Pro/Max',
    description: 'Conecta tu suscripcion Claude Pro o Max.',
    warn: 'El uso desde integraciones de terceros puede consumir extra usage facturado.',
  },
};

const TERMINAL_STATUSES: OAuthAttempt['status'][] = ['connected', 'failed', 'expired', 'cancelled'];

export default function SettingsTab() {
  const isAnonymous = useAuthStore((state) => state.isAnonymous);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [connections, setConnections] = useState<AiConnection[]>([]);
  const [attempt, setAttempt] = useState<OAuthAttempt | null>(null);
  const [manualInput, setManualInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    try {
      const data = await api.getAiConnections();
      setConnections(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las conexiones');
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      refresh();
    }
  }, [isAuthenticated]);

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
        throw new Error(done.error || 'Conexion cancelada o fallida');
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
      setError('Pega el codigo o la URL final');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.submitAiConnectionInput('anthropic', attempt.id, manualInput);
      const done = await waitFor('anthropic', attempt.id, ['connected']);
      if (done.status !== 'connected') {
        throw new Error(done.error || 'Conexion cancelada o fallida');
      }
      setManualInput('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo conectar');
    } finally {
      setLoading(false);
    }
  };

  if (isAnonymous || !isAuthenticated) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Configuracion</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Modo exploracion</Text>
          <Text style={styles.cardBody}>
            Necesitas una cuenta para conectar Codex o Anthropic y usar el analisis IA.
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => router.push('/login')}
            accessibilityLabel="Crear cuenta o iniciar sesion"
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>Crear cuenta o iniciar sesion</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Configuracion IA</Text>
      </View>
      {error ? (
        <View style={styles.errorCard} accessibilityRole="alert">
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
      {loading ? (
        <ActivityIndicator accessibilityLabel="Procesando conexion" color="#007AFF" />
      ) : null}
      {(['openai-codex', 'anthropic'] as AiProvider[]).map((provider) => {
        const connection = connections.find((c) => c.provider === provider);
        const meta = PROVIDER_LABELS[provider];
        return (
          <View key={provider} style={styles.card}>
            <Text style={styles.cardTitle}>{meta.title}</Text>
            <Text style={styles.cardBody}>{meta.description}</Text>
            {meta.warn ? <Text style={styles.warn}>{meta.warn}</Text> : null}
            <Text style={styles.status}>
              {connection
                ? connection.isActive
                  ? 'Activo'
                  : 'Conectado'
                : 'Desconectado'}
            </Text>
            {!connection ? (
              <TouchableOpacity
                style={styles.button}
                onPress={() =>
                  provider === 'openai-codex'
                    ? connectCodex(provider)
                    : api
                        .startAiConnection(provider)
                        .then((started) => {
                          setAttempt(started);
                          return waitFor(provider, started.id, ['awaiting-user']).then(
                            async (ready) => {
                              const url = ready.authorizationUrl;
                              if (url) await WebBrowser.openBrowserAsync(url);
                            },
                          );
                        })
                        .catch((e: Error) => setError(e.message))
                }
                accessibilityLabel={`Conectar ${meta.title}`}
                accessibilityRole="button"
              >
                <Text style={styles.buttonText}>Conectar</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.row}>
                {!connection.isActive ? (
                  <TouchableOpacity
                    style={[styles.button, styles.secondary]}
                    onPress={async () => {
                      try {
                        await api.setActiveAiConnection(provider);
                        await refresh();
                      } catch (e) {
                        setError(e instanceof Error ? e.message : 'No se pudo activar');
                      }
                    }}
                    accessibilityLabel={`Usar ${meta.title} para analisis`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.buttonText}>Usar para analisis</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={[styles.button, styles.danger]}
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
                  <Text style={styles.buttonText}>Desconectar</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        );
      })}

      {attempt?.provider === 'openai-codex' && attempt.userCode ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Codigo de verificacion</Text>
          <Text style={styles.codeText}>{attempt.userCode}</Text>
          <Text style={styles.cardBody}>
            Abre {attempt.verificationUri} en tu navegador e ingresa el codigo.
          </Text>
        </View>
      ) : null}

      {attempt?.provider === 'anthropic' && attempt.status === 'awaiting-user' ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Pega el codigo o URL final</Text>
          <TextInput
            style={styles.input}
            value={manualInput}
            onChangeText={setManualInput}
            placeholder="code#state o URL completa"
            placeholderTextColor="#9CA3AF"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Codigo de autorizacion"
          />
          <TouchableOpacity
            style={styles.button}
            onPress={submitAnthropic}
            accessibilityLabel="Confirmar codigo"
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>Confirmar codigo</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 16 },
  header: { marginBottom: 16 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#1a1a1a' },
  card: {
    backgroundColor: '#f9f9f9',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#1a1a1a' },
  cardBody: { fontSize: 14, color: '#4b5563', marginTop: 6 },
  warn: { fontSize: 12, color: '#b45309', marginTop: 6 },
  status: { fontSize: 12, color: '#007AFF', marginTop: 8, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 8, marginTop: 12 },
  button: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 12,
    alignItems: 'center',
  },
  secondary: { backgroundColor: '#1a1a1a', marginTop: 0, flex: 1 },
  danger: { backgroundColor: '#DC2626', marginTop: 0, flex: 1 },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#1a1a1a',
    marginTop: 8,
    backgroundColor: '#fff',
  },
  codeText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginTop: 8,
    letterSpacing: 2,
  },
  errorCard: {
    backgroundColor: '#FEE2E2',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  errorText: { color: '#991B1B', fontSize: 14 },
});
