import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import {
  AiConnection,
  AiConnectionType,
  AiOAuthProvider,
  AiProvider,
  AiProviderCatalogEntry,
  ModelInfo,
  OAuthAttempt,
  ValidateResponse,
  api,
} from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';
import { useAppTheme } from '../../lib/theme';
import { normalizeOAuthUserCode } from '../../lib/oauth-code';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const TERMINAL_STATUSES: OAuthAttempt['status'][] = ['connected', 'failed', 'expired', 'cancelled'];
const SUBSCRIPTION_GROUP = 'subscription';
const KEY_PLAN_GROUP = 'key-plan';
const API_KEY_GROUP = 'api-key';
const CUSTOM_GROUP = 'custom';

type CatalogByEntry = Record<string, AiProviderCatalogEntry[]>;

function groupCatalog(entries: AiProviderCatalogEntry[]): CatalogByEntry {
  const map: CatalogByEntry = {};
  for (const entry of entries) {
    const list = map[entry.id] ?? [];
    list.push(entry);
    map[entry.id] = list;
  }
  return map;
}

function findConnection(
  connections: AiConnection[],
  provider: AiProvider,
  connectionType?: AiConnectionType,
): AiConnection | undefined {
  if (connectionType) {
    return connections.find(
      (c) => c.provider === provider && c.connectionType === connectionType,
    );
  }
  return connections.find((c) => c.provider === provider);
}

function statusFor(connection: AiConnection | undefined, connectionType: AiConnectionType): {
  label: string;
  tone: 'success' | 'primary' | 'muted' | 'danger';
} {
  if (!connection || connection.connectionType !== connectionType) {
    return { label: 'Desconectado', tone: 'muted' };
  }
  if (connection.isActive) return { label: 'Activo', tone: 'success' };
  return { label: 'Conectado', tone: 'primary' };
}

export default function IaTab() {
  const { theme } = useAppTheme();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isAnonymous = useAuthStore((state) => state.isAnonymous);
  const canUsePrivateApi = isAuthenticated && !isAnonymous;

  const [catalog, setCatalog] = useState<AiProviderCatalogEntry[]>([]);
  const [connections, setConnections] = useState<AiConnection[]>([]);
  const [catalogError, setCatalogError] = useState(false);
  const [connectionsError, setConnectionsError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [oauthAttempt, setOauthAttempt] = useState<OAuthAttempt | null>(null);
  const [anthropicInput, setAnthropicInput] = useState('');
  const [codeCopyStatus, setCodeCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [apiKeyDrafts, setApiKeyDrafts] = useState<
    Record<string, { apiKey: string; model: string; baseUrl: string }>
  >({});
  const [draftsInitialized, setDraftsInitialized] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    [SUBSCRIPTION_GROUP]: true,
  });
  const [validatedModels, setValidatedModels] = useState<
    Record<string, { models: ModelInfo[]; defaultModel?: string }>
  >({});
  const [selectedModels, setSelectedModels] = useState<Record<string, string>>({});
  const [validatingProvider, setValidatingProvider] = useState<string | null>(null);

  const grouped = useMemo(() => groupCatalog(catalog), [catalog]);
  const orderedIds = useMemo(() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const entry of catalog) {
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        ids.push(entry.id);
      }
    }
    return ids;
  }, [catalog]);

  const loadAll = useCallback(async () => {
    if (!canUsePrivateApi) {
      setCatalog([]);
      setConnections([]);
      setCatalogError(false);
      setConnectionsError(false);
      setError('');
      setOauthAttempt(null);
      setAnthropicInput('');
      setCodeCopyStatus('idle');
      setBusyProvider(null);
      setApiKeyDrafts({});
      setDraftsInitialized(false);
      setExpandedSections({ [SUBSCRIPTION_GROUP]: true });
      setValidatedModels({});
      setSelectedModels({});
      setValidatingProvider(null);
      return;
    }
    const [catalogResult, connectionsResult] = await Promise.allSettled([
      api.getAiProviders(),
      api.getAiConnections(),
    ]);
    if (catalogResult.status === 'fulfilled') {
      setCatalog(catalogResult.value);
      setCatalogError(false);
    } else {
      setCatalogError(true);
    }
    if (connectionsResult.status === 'fulfilled') {
      setConnections(connectionsResult.value);
      setConnectionsError(false);
    } else {
      setConnections([]);
      setConnectionsError(true);
    }
  }, [canUsePrivateApi]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (draftsInitialized) return;
    if (catalog.length === 0) return;
    setApiKeyDrafts(() => {
      const next: Record<string, { apiKey: string; model: string; baseUrl: string }> = {};
      for (const entry of catalog) {
        next[entry.id] = {
          apiKey: '',
          model: entry.defaultModel ?? '',
          baseUrl: entry.defaultBaseUrl ?? '',
        };
      }
      return next;
    });
    setDraftsInitialized(true);
  }, [catalog, draftsInitialized]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadAll();
    } finally {
      setRefreshing(false);
    }
  };

  const waitFor = async (
    provider: AiOAuthProvider,
    id: string,
    wanted: OAuthAttempt['status'][],
  ): Promise<OAuthAttempt> => {
    for (let count = 0; count < 120; count++) {
      const next = await api.getAiConnectionAttempt(provider, id);
      setOauthAttempt(next);
      if (wanted.includes(next.status) || TERMINAL_STATUSES.includes(next.status)) {
        return next;
      }
      await sleep(1000);
    }
    throw new Error('Tiempo de espera agotado para el intento OAuth');
  };

  const connectCodex = async () => {
    if (!canUsePrivateApi) {
      router.push('/login');
      return;
    }
    setBusyProvider('openai-codex');
    setError('');
    setCodeCopyStatus('idle');
    try {
      const started = await api.startAiConnection('openai-codex');
      setOauthAttempt(started);
      const ready = await waitFor('openai-codex', started.id, ['awaiting-user']);
      if (ready.userCode) {
        const { compact } = normalizeOAuthUserCode(ready.userCode);
        try {
          await Clipboard.setStringAsync(compact);
          setCodeCopyStatus('copied');
        } catch {
          setCodeCopyStatus('failed');
        }
      }
      const url = ready.verificationUri || ready.authorizationUrl;
      if (url) await WebBrowser.openBrowserAsync(url);
      const done = await waitFor('openai-codex', started.id, ['connected']);
      if (done.status !== 'connected') {
        throw new Error(done.error || 'Conexión cancelada o fallida');
      }
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo conectar');
    } finally {
      setBusyProvider(null);
    }
  };

  const startAnthropic = async () => {
    if (!canUsePrivateApi) {
      router.push('/login');
      return;
    }
    setBusyProvider('anthropic');
    setError('');
    try {
      const started = await api.startAiConnection('anthropic');
      setOauthAttempt(started);
      const ready = await waitFor('anthropic', started.id, ['awaiting-user']);
      if (ready.authorizationUrl) {
        await WebBrowser.openBrowserAsync(ready.authorizationUrl);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo conectar');
    } finally {
      setBusyProvider(null);
    }
  };

  const submitAnthropic = async () => {
    if (!oauthAttempt || oauthAttempt.provider !== 'anthropic') return;
    if (!anthropicInput.trim()) {
      setError('Pega el código o la URL final');
      return;
    }
    setBusyProvider('anthropic');
    setError('');
    try {
      await api.submitAiConnectionInput('anthropic', oauthAttempt.id, anthropicInput);
      const done = await waitFor('anthropic', oauthAttempt.id, ['connected']);
      if (done.status !== 'connected') {
        throw new Error(done.error || 'Conexión cancelada o fallida');
      }
      setAnthropicInput('');
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo conectar');
    } finally {
      setBusyProvider(null);
    }
  };

  const copyOAuthCode = async (variant: 'compact' | 'formatted') => {
    if (!oauthAttempt?.userCode) return;
    const { compact, formatted } = normalizeOAuthUserCode(oauthAttempt.userCode);
    const value = variant === 'compact' ? compact : formatted;
    try {
      await Clipboard.setStringAsync(value);
      setCodeCopyStatus('copied');
    } catch {
      setCodeCopyStatus('failed');
    }
  };

  const openVerificationLink = async () => {
    if (!oauthAttempt) return;
    const url = oauthAttempt.verificationUri || oauthAttempt.authorizationUrl;
    if (!url) return;
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir el enlace');
    }
  };

  const updateDraft = (
    provider: AiProvider,
    patch: Partial<{ apiKey: string; model: string; baseUrl: string }>,
  ) => {
    setApiKeyDrafts((prev) => {
      const current = prev[provider];
      if (!current) return prev;
      return { ...prev, [provider]: { ...current, ...patch } };
    });
  };

  const submitApiKey = async (entry: AiProviderCatalogEntry) => {
    if (!canUsePrivateApi) {
      router.push('/login');
      return;
    }
    if (entry.connectionType !== 'api-key') return;
    const draft = apiKeyDrafts[entry.id] ?? { apiKey: '', model: entry.defaultModel ?? '', baseUrl: '' };
    if (!draft.apiKey.trim() || !draft.model.trim()) {
      setError('Completa la API key y el modelo');
      return;
    }
    setBusyProvider(entry.id);
    setError('');
    try {
      await api.connectApiKey(entry.id as never, {
        apiKey: draft.apiKey.trim(),
        model: draft.model.trim(),
      });
      setApiKeyDrafts((prev) => ({ ...prev, [entry.id]: { ...draft, apiKey: '' } }));
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la API key');
    } finally {
      setBusyProvider(null);
    }
  };

  const submitOpenAiCompatible = async (entry: AiProviderCatalogEntry) => {
    if (!canUsePrivateApi) {
      router.push('/login');
      return;
    }
    const draft = apiKeyDrafts[entry.id] ?? { apiKey: '', model: entry.defaultModel ?? '', baseUrl: entry.defaultBaseUrl ?? '' };
    if (!draft.apiKey.trim() || !draft.model.trim() || !draft.baseUrl.trim()) {
      setError('Completa base URL, API key y modelo');
      return;
    }
    setBusyProvider(entry.id);
    setError('');
    try {
      await api.connectOpenAiCompatible(
        entry.id as 'custom' | 'zai-coding-plan',
        {
          apiKey: draft.apiKey.trim(),
          model: draft.model.trim(),
          baseUrl: draft.baseUrl.trim(),
        },
      );
      setApiKeyDrafts((prev) => ({ ...prev, [entry.id]: { ...draft, apiKey: '' } }));
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la conexión');
    } finally {
      setBusyProvider(null);
    }
  };

  const setActive = async (provider: AiProvider, connectionType: AiConnectionType) => {
    setBusyProvider(`${provider}::${connectionType}`);
    setError('');
    try {
      await api.setActiveAiConnection(provider, connectionType);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo activar');
    } finally {
      setBusyProvider(null);
    }
  };

  const disconnect = async (provider: AiProvider, connectionType: AiConnectionType) => {
    setBusyProvider(`${provider}::${connectionType}::disconnect`);
    setError('');
    try {
      await api.disconnectAiConnection(provider, connectionType);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo desconectar');
    } finally {
      setBusyProvider(null);
    }
  };

  const renderSubscriptionCard = (entry: AiProviderCatalogEntry) => {
    const connection = findConnection(connections, entry.id, 'oauth');
    const status = statusFor(connection, 'oauth');
    const isCodex = entry.id === 'openai-codex';
    const isAnthropic = entry.id === 'anthropic';
    const connecting =
      busyProvider === entry.id ||
      (oauthAttempt?.provider === entry.id && !TERMINAL_STATUSES.includes(oauthAttempt.status));
    return (
      <View
        key={entry.id}
        style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}
      >
        <View style={styles.headerRow}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>{entry.displayName}</Text>
          <View
            style={[
              styles.statusBadge,
              { borderColor: theme[status.tone] },
            ]}
            accessibilityLabel={`${entry.displayName}: ${status.label}`}
          >
            <Text style={[styles.statusBadgeText, { color: theme[status.tone] }]}>{status.label}</Text>
          </View>
        </View>
        <Text style={[styles.cardBody, { color: theme.muted }]}>{entry.description}</Text>
        {entry.warning ? (
          <Text style={[styles.warn, { color: theme.warning }]}>{entry.warning}</Text>
        ) : null}
        {!connection ? (
          <TouchableOpacity
            style={[styles.button, { backgroundColor: theme.primary }, connecting && styles.buttonDisabled]}
            disabled={connecting}
            onPress={isCodex ? connectCodex : isAnthropic ? startAnthropic : undefined}
            accessibilityLabel={`Conectar ${entry.displayName}`}
            accessibilityRole="button"
          >
            <Text style={[styles.buttonText, { color: theme.primaryText }]}>
              {connecting ? 'Conectando…' : 'Conectar'}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.row}>
            {!connection.isActive ? (
              <TouchableOpacity
                style={[
                  styles.flexButton,
                  { backgroundColor: theme.text },
                  busyProvider === `${entry.id}::oauth` && styles.buttonDisabled,
                ]}
                disabled={busyProvider === `${entry.id}::oauth`}
                onPress={() => setActive(entry.id, 'oauth')}
                accessibilityLabel={`Usar ${entry.displayName} para análisis`}
                accessibilityRole="button"
              >
                <Text style={[styles.buttonText, { color: theme.background }]}>
                  Usar para análisis
                </Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[
                styles.flexButton,
                { backgroundColor: theme.danger },
                busyProvider === `${entry.id}::oauth::disconnect` && styles.buttonDisabled,
              ]}
              disabled={busyProvider === `${entry.id}::oauth::disconnect`}
              onPress={() => disconnect(entry.id, 'oauth')}
              accessibilityLabel={`Desconectar ${entry.displayName}`}
              accessibilityRole="button"
            >
              <Text style={[styles.buttonText, { color: theme.background }]}>Desconectar</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const renderApiKeyCard = (entry: AiProviderCatalogEntry) => {
    if (entry.connectionType !== 'api-key') return null;
    const connection = findConnection(connections, entry.id, 'api-key');
    const status = statusFor(connection, 'api-key');
    const draft = apiKeyDrafts[entry.id] ?? {
      apiKey: '',
      model: entry.defaultModel ?? '',
      baseUrl: entry.defaultBaseUrl ?? '',
    };
    const isBusy = busyProvider === entry.id;
    const isValidating = validatingProvider === entry.id;
    const validated = validatedModels[entry.id];
    const selectedModel = selectedModels[entry.id] ?? validated?.defaultModel ?? '';
    const keyLabel = entry.planType === 'token-plan' ? 'Subscription Key' : 'API key';
    const getKeyLabel = entry.planType === 'token-plan' ? 'Obtén tu Subscription Key' : 'Obtén tu API key';
    return (
      <View
        key={entry.id}
        style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}
      >
        <View style={styles.headerRow}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>{entry.displayName}</Text>
          <View
            style={[styles.statusBadge, { borderColor: theme[status.tone] }]}
            accessibilityLabel={`${entry.displayName}: ${status.label}`}
          >
            <Text style={[styles.statusBadgeText, { color: theme[status.tone] }]}>{status.label}</Text>
          </View>
        </View>
        <Text style={[styles.cardBody, { color: theme.muted }]}>{entry.description}</Text>
        {entry.warning ? (
          <Text style={[styles.warn, { color: theme.warning }]}>{entry.warning}</Text>
        ) : null}
        {connection ? (
          <Text style={[styles.helperText, { color: theme.muted }]}>
            Modelo: {connection.model ?? '—'}
          </Text>
        ) : null}
        {!connection ? (
          <>
            <Text style={[styles.inputLabel, { color: theme.muted }]}>{keyLabel}</Text>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: theme.surfaceElevated, borderColor: theme.border, color: theme.text },
              ]}
              value={draft.apiKey}
              onChangeText={(value) => updateDraft(entry.id, { apiKey: value })}
              placeholder={keyLabel}
              placeholderTextColor={theme.muted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              accessibilityLabel={`${keyLabel} de ${entry.displayName}`}
            />
            {entry.apiKeyUrl ? (
              <TouchableOpacity
                onPress={() => WebBrowser.openBrowserAsync(entry.apiKeyUrl!)}
                accessibilityLabel={getKeyLabel}
                accessibilityRole="link"
              >
                <Text style={[styles.linkText, { color: theme.primary }]}>{getKeyLabel} →</Text>
              </TouchableOpacity>
            ) : null}
            {!validated ? (
              <TouchableOpacity
                style={[
                  styles.button,
                  { backgroundColor: theme.primary },
                  (isBusy || isValidating) && styles.buttonDisabled,
                ]}
                disabled={isBusy || isValidating}
                onPress={() => validateKey(entry)}
                accessibilityLabel={`Validar ${keyLabel} de ${entry.displayName}`}
                accessibilityRole="button"
              >
                <Text style={[styles.buttonText, { color: theme.primaryText }]}>
                  {isValidating ? 'Validando…' : 'Validar key'}
                </Text>
              </TouchableOpacity>
            ) : (
              <>
                {validated.models.length > 0
                  ? renderModelSelector(entry.id, validated.models)
                  : (
                    <>
                      <Text style={[styles.inputLabel, { color: theme.muted }]}>Modelo</Text>
                      <TextInput
                        style={[
                          styles.input,
                          { backgroundColor: theme.surfaceElevated, borderColor: theme.border, color: theme.text },
                        ]}
                        value={selectedModel}
                        onChangeText={(value) => setSelectedModels((prev) => ({ ...prev, [entry.id]: value }))}
                        placeholder={entry.defaultModel ?? 'modelo'}
                        placeholderTextColor={theme.muted}
                        autoCapitalize="none"
                        autoCorrect={false}
                        accessibilityLabel={`Modelo de ${entry.displayName}`}
                      />
                    </>
                  )}
                <TouchableOpacity
                  style={[
                    styles.button,
                    { backgroundColor: theme.primary },
                    (isBusy || !selectedModel.trim()) && styles.buttonDisabled,
                  ]}
                  disabled={isBusy || !selectedModel.trim()}
                  onPress={async () => {
                    if (!selectedModel.trim()) return;
                    setBusyProvider(entry.id);
                    setError('');
                    try {
                      await api.connectApiKey(entry.id as never, {
                        apiKey: draft.apiKey.trim(),
                        model: selectedModel.trim(),
                      });
                      setApiKeyDrafts((prev) => ({ ...prev, [entry.id]: { ...draft, apiKey: '' } }));
                      setValidatedModels((prev) => { const next = { ...prev }; delete next[entry.id]; return next; });
                      setSelectedModels((prev) => { const next = { ...prev }; delete next[entry.id]; return next; });
                      await loadAll();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'No se pudo guardar la conexión');
                    } finally {
                      setBusyProvider(null);
                    }
                  }}
                  accessibilityLabel={`Guardar conexión de ${entry.displayName}`}
                  accessibilityRole="button"
                >
                  <Text style={[styles.buttonText, { color: theme.primaryText }]}>
                    {isBusy ? 'Guardando…' : 'Guardar conexión'}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </>
        ) : (
          <View style={styles.row}>
            {!connection.isActive ? (
              <TouchableOpacity
                style={[
                  styles.flexButton,
                  { backgroundColor: theme.text },
                  busyProvider === `${entry.id}::api-key` && styles.buttonDisabled,
                ]}
                disabled={busyProvider === `${entry.id}::api-key`}
                onPress={() => setActive(entry.id, 'api-key')}
                accessibilityLabel={`Usar ${entry.displayName} para análisis`}
                accessibilityRole="button"
              >
                <Text style={[styles.buttonText, { color: theme.background }]}>
                  Usar para análisis
                </Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[
                styles.flexButton,
                { backgroundColor: theme.danger },
                busyProvider === `${entry.id}::api-key::disconnect` && styles.buttonDisabled,
              ]}
              disabled={busyProvider === `${entry.id}::api-key::disconnect`}
              onPress={() => disconnect(entry.id, 'api-key')}
              accessibilityLabel={`Desconectar ${entry.displayName}`}
              accessibilityRole="button"
            >
              <Text style={[styles.buttonText, { color: theme.background }]}>Desconectar</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };


  const renderCustomCard = (entry: AiProviderCatalogEntry) => {
    if (entry.connectionType !== 'openai-compatible') return null;
    const connection = findConnection(connections, entry.id, 'openai-compatible');
    const status = statusFor(connection, 'openai-compatible');
    const draft = apiKeyDrafts[entry.id] ?? {
      apiKey: '',
      model: entry.defaultModel ?? '',
      baseUrl: entry.defaultBaseUrl ?? '',
    };
    const isBusy = busyProvider === entry.id;
    const isValidating = validatingProvider === entry.id;
    const validated = validatedModels[entry.id];
    const selectedModel = selectedModels[entry.id] ?? validated?.defaultModel ?? '';
    const baseUrlEditable = entry.planType !== 'coding-plan';
    return (
      <View
        key={entry.id}
        style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}
      >
        <View style={styles.headerRow}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>{entry.displayName}</Text>
          <View
            style={[styles.statusBadge, { borderColor: theme[status.tone] }]}
            accessibilityLabel={`${entry.displayName}: ${status.label}`}
          >
            <Text style={[styles.statusBadgeText, { color: theme[status.tone] }]}>{status.label}</Text>
          </View>
        </View>
        <Text style={[styles.cardBody, { color: theme.muted }]}>{entry.description}</Text>
        {entry.warning ? (
          <Text style={[styles.warn, { color: theme.warning }]}>{entry.warning}</Text>
        ) : null}
        {connection ? (
          <Text style={[styles.helperText, { color: theme.muted }]}>
            {connection.baseUrl} · {connection.model}
          </Text>
        ) : null}
        {!connection ? (
          <>
            {baseUrlEditable ? (
              <>
                <Text style={[styles.inputLabel, { color: theme.muted }]}>Base URL</Text>
                <TextInput
                  style={[
                    styles.input,
                    { backgroundColor: theme.surfaceElevated, borderColor: theme.border, color: theme.text },
                  ]}
                  value={draft.baseUrl}
                  onChangeText={(value) => updateDraft(entry.id, { baseUrl: value })}
                  placeholder={entry.defaultBaseUrl ?? 'http://localhost:11434/v1'}
                  placeholderTextColor={theme.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Base URL del endpoint OpenAI-compatible"
                />
              </>
            ) : (
              <Text style={[styles.helperText, { color: theme.muted }]}>
                Endpoint: {entry.defaultBaseUrl}
              </Text>
            )}
            <Text style={[styles.inputLabel, { color: theme.muted }]}>API key</Text>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: theme.surfaceElevated, borderColor: theme.border, color: theme.text },
              ]}
              value={draft.apiKey}
              onChangeText={(value) => updateDraft(entry.id, { apiKey: value })}
              placeholder="API key"
              placeholderTextColor={theme.muted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              accessibilityLabel={`API key de ${entry.displayName}`}
            />
            {entry.apiKeyUrl ? (
              <TouchableOpacity
                onPress={() => WebBrowser.openBrowserAsync(entry.apiKeyUrl!)}
                accessibilityLabel="Obtén tu API key"
                accessibilityRole="link"
              >
                <Text style={[styles.linkText, { color: theme.primary }]}>Obtén tu API key →</Text>
              </TouchableOpacity>
            ) : null}
            {!validated ? (
              <TouchableOpacity
                style={[
                  styles.button,
                  { backgroundColor: theme.primary },
                  (isBusy || isValidating) && styles.buttonDisabled,
                ]}
                disabled={isBusy || isValidating}
                onPress={() => validateKey(entry)}
                accessibilityLabel={`Validar API key de ${entry.displayName}`}
                accessibilityRole="button"
              >
                <Text style={[styles.buttonText, { color: theme.primaryText }]}>
                  {isValidating ? 'Validando…' : 'Validar key'}
                </Text>
              </TouchableOpacity>
            ) : (
              <>
                {validated.models.length > 0
                  ? renderModelSelector(entry.id, validated.models)
                  : (
                    <>
                      <Text style={[styles.inputLabel, { color: theme.muted }]}>Modelo</Text>
                      <TextInput
                        style={[
                          styles.input,
                          { backgroundColor: theme.surfaceElevated, borderColor: theme.border, color: theme.text },
                        ]}
                        value={selectedModel}
                        onChangeText={(value) => setSelectedModels((prev) => ({ ...prev, [entry.id]: value }))}
                        placeholder={entry.defaultModel ?? 'modelo (manual fallback)'}
                        placeholderTextColor={theme.muted}
                        autoCapitalize="none"
                        autoCorrect={false}
                        accessibilityLabel={`Modelo de ${entry.displayName}`}
                      />
                      <Text style={[styles.helperText, { color: theme.muted }]}>
                        Si el endpoint no expone /models, escribe el modelo manualmente.
                      </Text>
                    </>
                  )}
                <TouchableOpacity
                  style={[
                    styles.button,
                    { backgroundColor: theme.primary },
                    (isBusy || !selectedModel.trim()) && styles.buttonDisabled,
                  ]}
                  disabled={isBusy || !selectedModel.trim()}
                  onPress={async () => {
                    if (!selectedModel.trim()) return;
                    const effectiveBaseUrl = baseUrlEditable
                      ? draft.baseUrl.trim()
                      : (entry.defaultBaseUrl ?? draft.baseUrl.trim());
                    if (!effectiveBaseUrl) {
                      setError('La base URL es requerida');
                      return;
                    }
                    setBusyProvider(entry.id);
                    setError('');
                    try {
                      const providerId = entry.id as 'custom' | 'zai-coding-plan';
                      await api.connectOpenAiCompatible(providerId, {
                        apiKey: draft.apiKey.trim(),
                        model: selectedModel.trim(),
                        baseUrl: effectiveBaseUrl,
                      });
                      setApiKeyDrafts((prev) => ({ ...prev, [entry.id]: { ...draft, apiKey: '' } }));
                      setValidatedModels((prev) => { const next = { ...prev }; delete next[entry.id]; return next; });
                      setSelectedModels((prev) => { const next = { ...prev }; delete next[entry.id]; return next; });
                      await loadAll();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'No se pudo guardar la conexión');
                    } finally {
                      setBusyProvider(null);
                    }
                  }}
                  accessibilityLabel={`Guardar conexión de ${entry.displayName}`}
                  accessibilityRole="button"
                >
                  <Text style={[styles.buttonText, { color: theme.primaryText }]}>
                    {isBusy ? 'Guardando…' : 'Guardar conexión'}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </>
        ) : (
          <View style={styles.row}>
            {!connection.isActive ? (
              <TouchableOpacity
                style={[
                  styles.flexButton,
                  { backgroundColor: theme.text },
                  busyProvider === `${entry.id}::openai-compatible` && styles.buttonDisabled,
                ]}
                disabled={busyProvider === `${entry.id}::openai-compatible`}
                onPress={() => setActive(entry.id, 'openai-compatible')}
                accessibilityLabel={`Usar ${entry.displayName} para análisis`}
                accessibilityRole="button"
              >
                <Text style={[styles.buttonText, { color: theme.background }]}>
                  Usar para análisis
                </Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[
                styles.flexButton,
                { backgroundColor: theme.danger },
                busyProvider === `${entry.id}::openai-compatible::disconnect` && styles.buttonDisabled,
              ]}
              disabled={busyProvider === `${entry.id}::openai-compatible::disconnect`}
              onPress={() => disconnect(entry.id, 'openai-compatible')}
              accessibilityLabel={`Desconectar ${entry.displayName}`}
              accessibilityRole="button"
            >
              <Text style={[styles.buttonText, { color: theme.background }]}>Desconectar</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };


  const renderAccordionSection = (
    group: string,
    title: string,
    entries: AiProviderCatalogEntry[],
    renderCard: (entry: AiProviderCatalogEntry) => React.ReactNode,
  ) => {
    const isExpanded = expandedSections[group] ?? false;
    const active = hasActiveInGroup(entries);
    return (
      <View style={styles.section} key={group}>
        <TouchableOpacity
          style={[styles.sectionHeader, { borderBottomColor: theme.border }]}
          onPress={() => toggleSection(group)}
          accessibilityRole="button"
          accessibilityState={{ expanded: isExpanded }}
          accessibilityLabel={`${title}: ${entries.length} proveedores${active ? ', tiene conexión activa' : ''}`}
        >
          <View style={styles.sectionHeaderLeft}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>{title}</Text>
            <Text style={[styles.sectionCount, { color: theme.muted }]}>
              {entries.length}
            </Text>
            {active ? (
              <View style={[styles.activeDot, { backgroundColor: theme.success }]} />
            ) : null}
          </View>
          <Text style={[styles.chevron, { color: theme.muted }]}>
            {isExpanded ? '▲' : '▼'}
          </Text>
        </TouchableOpacity>
        {isExpanded ? (
          entries.length === 0 ? (
            <ActivityIndicator
              accessibilityLabel="Cargando catálogo"
              color={theme.primary}
              style={styles.sectionLoader}
            />
          ) : (
            entries.map(renderCard)
          )
        ) : null}
      </View>
    );
  };

  const renderModelSelector = (entryId: string, models: ModelInfo[]) => {
    const current = selectedModels[entryId] ?? validatedModels[entryId]?.defaultModel ?? '';
    return (
      <View style={styles.modelSelector}>
        <Text style={[styles.inputLabel, { color: theme.muted }]}>Modelo</Text>
        {models.map((model) => (
          <TouchableOpacity
            key={model.id}
            style={[
              styles.modelOption,
              { borderColor: theme.border, backgroundColor: theme.surfaceElevated },
              current === model.id && { borderColor: theme.primary, backgroundColor: theme.primary + '15' },
            ]}
            onPress={() => setSelectedModels((prev) => ({ ...prev, [entryId]: model.id }))}
            accessibilityRole="radio"
            accessibilityState={{ checked: current === model.id }}
            accessibilityLabel={`${model.label}${model.recommended ? ' (recomendado)' : ''}`}
          >
            <Text style={[styles.modelOptionText, { color: theme.text }]}>{model.label}</Text>
            {model.recommended ? (
              <Text style={[styles.modelRecommended, { color: theme.primary }]}>★</Text>
            ) : null}
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  const subscriptionEntries = orderedIds
    .map((id) => grouped[id]?.find((e) => e.group === SUBSCRIPTION_GROUP))
    .filter(Boolean) as AiProviderCatalogEntry[];
  const keyPlanEntries = orderedIds
    .map((id) => grouped[id]?.find((e) => e.group === KEY_PLAN_GROUP))
    .filter(Boolean) as AiProviderCatalogEntry[];
  const apiKeyEntries = orderedIds
    .map((id) => grouped[id]?.find((e) => e.group === API_KEY_GROUP))
    .filter(Boolean) as AiProviderCatalogEntry[];
  const customEntries = orderedIds
    .map((id) => grouped[id]?.find((e) => e.group === CUSTOM_GROUP))
    .filter(Boolean) as AiProviderCatalogEntry[];

  const toggleSection = (group: string) => {
    setExpandedSections((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  const hasActiveInGroup = (entries: AiProviderCatalogEntry[]) =>
    entries.some((entry) => {
      const conn = findConnection(connections, entry.id, entry.connectionType);
      return conn?.isActive;
    });

  const validateKey = async (entry: AiProviderCatalogEntry) => {
    if (!canUsePrivateApi) {
      router.push('/login');
      return;
    }
    const draft = apiKeyDrafts[entry.id] ?? { apiKey: '', model: '', baseUrl: '' };
    if (!draft.apiKey.trim()) {
      setError('Ingresa la API key antes de validar');
      return;
    }
    setValidatingProvider(entry.id);
    setError('');
    try {
      const result = await api.validateApiKey(entry.id, {
        connectionType: entry.connectionType === 'openai-compatible' ? 'openai-compatible' : 'api-key',
        apiKey: draft.apiKey.trim(),
        baseUrl: draft.baseUrl?.trim() || entry.defaultBaseUrl || undefined,
      });
      setValidatedModels((prev) => ({
        ...prev,
        [entry.id]: { models: result.models, defaultModel: result.defaultModel },
      }));
      setSelectedModels((prev) => {
        const next = { ...prev };
        delete next[entry.id];
        if (result.defaultModel) next[entry.id] = result.defaultModel;
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo validar la API key');
    } finally {
      setValidatingProvider(null);
    }
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.primary}
        />
      }
    >
      {error ? (
        <View
          style={[styles.errorCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
          accessibilityRole="alert"
        >
          <Text style={[styles.errorText, { color: theme.danger }]}>{error}</Text>
        </View>
      ) : null}

      {!canUsePrivateApi ? (
        <View
          style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}
        >
          <Text style={[styles.cardTitle, { color: theme.text }]}>Conexiones IA privadas</Text>
          <Text style={[styles.cardBody, { color: theme.muted }]}>
            Necesitas una cuenta para conectar proveedores IA y usarlos en el análisis.
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
          {catalogError || connectionsError ? (
            <View
              style={[styles.errorCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
            >
              <Text style={[styles.errorText, { color: theme.muted }]}>
                {catalogError
                  ? 'No se pudo cargar el catálogo de proveedores.'
                  : 'No se pudo cargar el estado de las conexiones.'}
              </Text>
            </View>
          ) : null}

          {renderAccordionSection(
            SUBSCRIPTION_GROUP,
            'Suscripciones',
            subscriptionEntries,
            renderSubscriptionCard,
          )}
          {keyPlanEntries.length > 0
            ? renderAccordionSection(KEY_PLAN_GROUP, 'Planes con key', keyPlanEntries, (entry) =>
                entry.connectionType === 'openai-compatible'
                  ? renderCustomCard(entry)
                  : renderApiKeyCard(entry),
              )
            : null}
          {renderAccordionSection(API_KEY_GROUP, 'API key', apiKeyEntries, renderApiKeyCard)}
          {renderAccordionSection(CUSTOM_GROUP, 'Local / custom', customEntries, renderCustomCard)}

          {oauthAttempt?.provider === 'openai-codex' && oauthAttempt.userCode ? (
            <View
              style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}
            >
              <Text style={[styles.cardTitle, { color: theme.text }]}>Código de verificación</Text>
              <Text
                style={[styles.codeText, { color: theme.text }]}
                accessibilityLabel={`Código de verificación ${oauthAttempt.userCode}`}
                selectable
              >
                {oauthAttempt.userCode}
              </Text>
              <Text style={[styles.cardBody, { color: theme.muted }]}>
                {codeCopyStatus === 'copied'
                  ? 'Código copiado al portapapeles. Pégalo en la pantalla de OpenAI.'
                  : codeCopyStatus === 'failed'
                    ? 'No se pudo copiar automáticamente. Usa los botones de abajo.'
                    : 'Abre el enlace en tu navegador e ingresa el código.'}
              </Text>
              <Text style={[styles.helperText, { color: theme.muted }]}>
                Si el sitio solo pega una letra, usa Copiar código y vuelve a pegar; si sigue
                pasando, escribe los grupos visibles.
              </Text>
              <View style={styles.row}>
                <TouchableOpacity
                  style={[styles.flexButton, { backgroundColor: theme.primary }]}
                  onPress={() => copyOAuthCode('compact')}
                  accessibilityLabel="Copiar código completo sin espacios"
                  accessibilityRole="button"
                >
                  <Text style={[styles.buttonText, { color: theme.primaryText }]}>Copiar código</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.flexButton,
                    {
                      backgroundColor: theme.surfaceElevated,
                      borderWidth: 1,
                      borderColor: theme.border,
                    },
                  ]}
                  onPress={() => copyOAuthCode('formatted')}
                  accessibilityLabel="Copiar código con formato original"
                  accessibilityRole="button"
                >
                  <Text style={[styles.buttonText, { color: theme.text }]}>Copiar con formato</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[styles.outlineButton, { borderColor: theme.border }]}
                onPress={openVerificationLink}
                accessibilityLabel="Abrir enlace de verificación"
                accessibilityRole="button"
              >
                <Text style={[styles.outlineButtonText, { color: theme.text }]}>Abrir enlace</Text>
              </TouchableOpacity>
              <Text style={[styles.helperText, { color: theme.muted }]}>
                Enlace: {oauthAttempt.verificationUri}
              </Text>
            </View>
          ) : null}

          {oauthAttempt?.provider === 'anthropic' && oauthAttempt.status === 'awaiting-user' ? (
            <View
              style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}
            >
              <Text style={[styles.cardTitle, { color: theme.text }]}>Pega el código o URL final</Text>
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: theme.surfaceElevated, borderColor: theme.border, color: theme.text },
                ]}
                value={anthropicInput}
                onChangeText={setAnthropicInput}
                placeholder="code#state o URL completa"
                placeholderTextColor={theme.muted}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Código de autorización Anthropic"
              />
              <TouchableOpacity
                style={[styles.button, { backgroundColor: theme.primary }]}
                onPress={submitAnthropic}
                accessibilityLabel="Confirmar código Anthropic"
                accessibilityRole="button"
              >
                <Text style={[styles.buttonText, { color: theme.primaryText }]}>Confirmar código</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  section: { marginBottom: 24 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: { fontSize: 18, fontWeight: '700' },
  sectionCount: { fontSize: 14, fontWeight: '500' },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  chevron: { fontSize: 12, fontWeight: '700' },
  sectionLoader: { marginVertical: 12 },
  panel: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  cardBody: { fontSize: 14, marginTop: 6, lineHeight: 20 },
  helperText: { fontSize: 12, marginTop: 8, lineHeight: 18 },
  warn: { fontSize: 12, marginTop: 6, fontWeight: '600' },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusBadgeText: { fontSize: 12, fontWeight: '700' },
  inputLabel: { fontSize: 12, marginTop: 12, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    marginTop: 4,
  },
  row: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
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
  buttonText: { fontSize: 14, fontWeight: '700' },
  outlineButtonText: { fontSize: 14, fontWeight: '700' },
  buttonDisabled: { opacity: 0.5 },
  errorCard: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
  },
  errorText: { fontSize: 14 },
  codeText: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 8,
    letterSpacing: 2,
  },
  linkText: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
  },
  modelSelector: {
    marginTop: 12,
  },
  modelOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginTop: 6,
  },
  modelOptionText: {
    fontSize: 14,
    flexShrink: 1,
  },
  modelRecommended: {
    fontSize: 14,
    fontWeight: '700',
  },
});
