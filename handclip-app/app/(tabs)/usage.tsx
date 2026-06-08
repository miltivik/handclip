import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { QuotaInfo, api } from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';
import { useAppTheme } from '../../lib/theme';

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  pro: 'Pro',
  admin: 'Admin',
};

const COLOR_THRESHOLDS = {
  warning: 80,
  danger: 100,
} as const;

function computeUsagePercent(quota: QuotaInfo): number | null {
  if (quota.isUnlimited || quota.maxExports === null) return null;
  if (quota.maxExports <= 0) return 0;
  const raw = (quota.exportsThisMonth / quota.maxExports) * 100;
  return Math.min(100, Math.round(raw));
}

function pickUsageColor(
  percent: number,
  theme: ReturnType<typeof useAppTheme>['theme'],
): string {
  if (percent >= COLOR_THRESHOLDS.danger) return theme.danger;
  if (percent >= COLOR_THRESHOLDS.warning) return theme.warning;
  return theme.primary;
}

export default function UsageTab() {
  const { theme } = useAppTheme();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isAnonymous = useAuthStore((state) => state.isAnonymous);
  const canUsePrivateApi = isAuthenticated && !isAnonymous;
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [quotaError, setQuotaError] = useState(false);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [billingLoading, setBillingLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadQuota = useCallback(async () => {
    if (!canUsePrivateApi) {
      setQuota(null);
      setQuotaError(false);
      setQuotaLoading(false);
      setError('');
      return;
    }
    setQuotaError(false);
    setQuotaLoading(true);
    setError('');
    try {
      const data = await api.getQuota();
      setQuota(data);
    } catch {
      setQuota(null);
      setQuotaError(true);
    } finally {
      setQuotaLoading(false);
    }
  }, [canUsePrivateApi]);

  useEffect(() => {
    loadQuota();
  }, [loadQuota]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadQuota();
    } finally {
      setRefreshing(false);
    }
  };

  const openBillingCheckout = async () => {
    if (!canUsePrivateApi) {
      router.push('/login');
      return;
    }
    setBillingLoading(true);
    setError('');
    try {
      const checkout = await api.createBillingCheckout();
      await WebBrowser.openBrowserAsync(checkout.url);
      try {
        setQuotaError(false);
        setQuotaLoading(true);
        setQuota(await api.getQuota());
      } catch {
        setQuota(null);
        setQuotaError(true);
      } finally {
        setQuotaLoading(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir el checkout');
    } finally {
      setBillingLoading(false);
    }
  };

  const usagePercent = quota ? computeUsagePercent(quota) : null;
  const planLabel = quota ? (PLAN_LABELS[quota.plan] ?? quota.plan) : '';
  const remaining =
    quota && quota.maxExports !== null
      ? Math.max(quota.maxExports - quota.exportsThisMonth, 0)
      : null;
  const fillColor = usagePercent !== null ? pickUsageColor(usagePercent, theme) : theme.primary;

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

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Plan y cuota</Text>
        {canUsePrivateApi ? (
          quota ? (
            <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <View style={styles.headerRow}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>Plan actual</Text>
                <View
                  style={[styles.planBadge, { backgroundColor: theme.primary }]}
                  accessibilityLabel={`Plan ${planLabel}`}
                >
                  <Text style={[styles.planBadgeText, { color: theme.primaryText }]}>
                    {planLabel}
                  </Text>
                </View>
              </View>

              {quota.isUnlimited || quota.maxExports === null ? (
                <View style={styles.unlimitedBlock}>
                  <Text style={[styles.unlimitedHeadline, { color: theme.success }]}>
                    Ilimitado
                  </Text>
                  <Text style={[styles.cardBody, { color: theme.muted }]}>
                    Sin límite mensual. Los contadores externos del proveedor no están
                    disponibles vía API confiable.
                  </Text>
                </View>
              ) : (
                <>
                  <Text
                    style={[
                      styles.cardBody,
                      {
                        color:
                          quota.exportsThisMonth >= quota.maxExports
                            ? theme.danger
                            : theme.text,
                        fontWeight: '600',
                      },
                    ]}
                  >
                    Exports este mes: {quota.exportsThisMonth} / {quota.maxExports}
                  </Text>

                  <View
                    style={[styles.progressTrack, { backgroundColor: theme.border }]}
                    accessibilityLabel={`${usagePercent ?? 0}% de la cuota usada`}
                  >
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${usagePercent ?? 0}%`,
                          backgroundColor: fillColor,
                        },
                      ]}
                    />
                  </View>

                  <View style={styles.metaRow}>
                    <Text style={[styles.metaText, { color: theme.muted }]}>
                      {usagePercent ?? 0}% usado
                    </Text>
                    <Text
                      style={[
                        styles.metaText,
                        {
                          color:
                            quota.exportsThisMonth >= quota.maxExports
                              ? theme.danger
                              : remaining !== null && remaining <= 1
                                ? theme.warning
                                : theme.muted,
                        },
                      ]}
                    >
                      {remaining} restante{remaining === 1 ? '' : 's'}
                    </Text>
                  </View>
                </>
              )}

              {!quota.isUnlimited ? (
                <TouchableOpacity
                  style={[
                    styles.button,
                    { backgroundColor: theme.primary },
                    billingLoading && styles.buttonDisabled,
                  ]}
                  disabled={billingLoading}
                  onPress={openBillingCheckout}
                  accessibilityLabel="Activar plan Pro"
                  accessibilityRole="button"
                >
                  <Text style={[styles.buttonText, { color: theme.primaryText }]}>
                    {billingLoading ? 'Abriendo...' : 'Activar plan Pro'}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : quotaError ? (
            <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.cardBody, { color: theme.muted }]}>
                No se pudo cargar tu cuota actual.
              </Text>
            </View>
          ) : quotaLoading ? (
            <ActivityIndicator
              accessibilityLabel="Cargando cuota"
              color={theme.primary}
              style={styles.sectionLoader}
            />
          ) : null
        ) : (
          <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.cardBody, { color: theme.muted }]}>
              La cuota aparece cuando inicias sesión.
            </Text>
            <TouchableOpacity
              style={[styles.button, { backgroundColor: theme.primary }]}
              onPress={() => router.push('/login')}
              accessibilityLabel="Iniciar sesión para ver cuota"
              accessibilityRole="button"
            >
              <Text style={[styles.buttonText, { color: theme.primaryText }]}>Iniciar sesión</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 10 },
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
  unlimitedBlock: { marginTop: 10 },
  unlimitedHeadline: { fontSize: 22, fontWeight: '700' },
  progressTrack: {
    marginTop: 12,
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  metaText: { fontSize: 12, fontWeight: '600' },
  planBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  planBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
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
  buttonText: { fontSize: 14, fontWeight: '700' },
  buttonDisabled: { opacity: 0.5 },
  sectionLoader: { marginVertical: 12 },
  errorCard: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
  },
  errorText: { fontSize: 14 },
});
