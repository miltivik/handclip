import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Linking, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import EmptyState from '../../components/ui/EmptyState';
import { api, ExportItem } from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';
import { useAppTheme } from '../../lib/theme';

interface ExportCardProps {
  item: ExportItem;
}

function ExportCard({ item }: ExportCardProps) {
  const { theme } = useAppTheme();

  const handleDownload = async () => {
    if (!item.output_url) {
      Alert.alert('Exportación en proceso', 'El video aún se está procesando. Intenta de nuevo en unos minutos.');
      return;
    }
    try {
      await Linking.openURL(item.output_url);
    } catch {
      try {
        await Share.share({ url: item.output_url });
      } catch {
        Alert.alert('Error', 'No se pudo abrir el archivo.');
      }
    }
  };

  const formatDuration = (seconds: number | null): string => {
    if (seconds === null) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateString: string | null): string => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const getPresetColor = (preset: string): string => {
    const presetLower = preset.toLowerCase();
    if (presetLower.includes('instagram') || presetLower.includes('reel')) return '#E1306C';
    if (presetLower.includes('twitter') || presetLower.includes('x')) return '#1DA1F2';
    if (presetLower.includes('tiktok')) return '#111827';
    if (presetLower.includes('youtube')) return '#FF0000';
    return theme.muted;
  };

  const dateDisplay = item.completed_at ? formatDate(item.completed_at) : formatDate(item.created_at);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <View style={[styles.thumbnail, { backgroundColor: theme.overlay }]}>
        <Text style={[styles.thumbnailText, { color: theme.muted }]}>{item.preset}</Text>
      </View>
      <Text style={[styles.projectTitle, { color: theme.text }]} numberOfLines={1}>
        {item.project_title}
      </Text>
      <View style={styles.infoRow}>
        <View style={[styles.presetBadge, { backgroundColor: getPresetColor(item.preset) }]}>
          <Text style={styles.presetBadgeText}>{item.preset}</Text>
        </View>
        <Text style={[styles.duration, { color: theme.muted }]}>{formatDuration(item.duration)}</Text>
      </View>
      <View style={styles.dateRow}>
        <Ionicons name="calendar-outline" size={12} color={theme.muted} />
        <Text style={[styles.dateText, { color: theme.muted }]}>{dateDisplay}</Text>
      </View>
      <TouchableOpacity
        style={[styles.downloadButton, { backgroundColor: theme.primary }]}
        onPress={handleDownload}
        accessibilityLabel="Descargar clip"
        accessibilityRole="button"
      >
        <Ionicons name="download-outline" size={16} color={theme.primaryText} />
        <Text style={[styles.downloadButtonText, { color: theme.primaryText }]}>Descargar</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function LibraryScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const isAnonymous = useAuthStore((state) => state.isAnonymous);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [exports, setExports] = useState<ExportItem[]>([]);
  const [isLoading, setIsLoading] = useState(isAuthenticated && !isAnonymous);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAnonymous || !isAuthenticated) {
      setExports([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    const fetchExports = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await api.getExports();
        setExports(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cargar las exportaciones');
      } finally {
        setIsLoading(false);
      }
    };

    fetchExports();
  }, [isAnonymous, isAuthenticated]);

  const handleLogin = () => {
    router.push('/login');
  };

  const handleRetry = () => {
    if (isAuthenticated && !isAnonymous) {
      setIsLoading(true);
      setError(null);
      api.getExports()
        .then(setExports)
        .catch((err) => setError(err instanceof Error ? err.message : 'Error al cargar las exportaciones'))
        .finally(() => setIsLoading(false));
    }
  };

  if (isAnonymous || !isAuthenticated) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.background }]}>
        <EmptyState
          icon="person-outline"
          title="Inicia sesión para ver tus clips exportados"
          subtitle="Accede a tu cuenta para gestionar tus exportaciones."
          ctaLabel="Iniciar sesión"
          onCtaPress={handleLogin}
        />
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.primary} accessibilityLabel="Cargando exportaciones" />
        <Text style={[styles.loadingText, { color: theme.muted }]}>Cargando exportaciones...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.background }]}>
        <EmptyState
          icon="alert-circle-outline"
          title="Error al cargar"
          subtitle={error}
          ctaLabel="Reintentar"
          onCtaPress={handleRetry}
        />
      </View>
    );
  }

  if (exports.length === 0) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.background }]}>
        <EmptyState
          icon="folder-open-outline"
          title="Aún no tienes clips exportados"
          subtitle="Los clips que exportes aparecerán aquí."
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <FlatList
        data={exports}
        keyExtractor={(item) => item.id}
        numColumns={2}
        contentContainerStyle={styles.listContent}
        columnWrapperStyle={styles.columnWrapper}
        renderItem={({ item }) => <ExportCard item={item} />}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: 12,
  },
  columnWrapper: {
    gap: 12,
    marginBottom: 12,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  card: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    padding: 8,
    maxWidth: '50%',
  },
  thumbnail: {
    aspectRatio: 9 / 16,
    maxHeight: 120,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  thumbnailText: {
    fontSize: 11,
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  projectTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    gap: 6,
  },
  presetBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  presetBadgeText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  duration: {
    fontSize: 11,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  dateText: {
    fontSize: 10,
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 8,
    minHeight: 44,
  },
  downloadButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
