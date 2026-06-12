import { useState, useEffect } from 'react';
import { FlatList, View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { api, Project } from '../../services/api';
import EmptyState from '../../components/ui/EmptyState';

interface ExportItem {
  id: string;
  status: string;
  outputUrl?: string;
  preset: string;
  createdAt: string;
  projectName: string;
}

export default function LibraryScreen() {
  const router = useRouter();
  const [exports, setExports] = useState<ExportItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadExports();
  }, []);

  const loadExports = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const projects = await api.getProjects();
      const allExports: ExportItem[] = [];

      for (const project of projects) {
        try {
          const projectExports = await api.getExports(project.id);
          for (const exp of projectExports) {
            if (exp.status === 'completed' || exp.status === 'rendering') {
              allExports.push({
                ...exp,
                projectName: project.name || 'Sin título',
              });
            }
          }
        } catch {
          // Skip projects that fail to load exports
        }
      }

      allExports.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setExports(allExports);
    } catch (err: any) {
      setError(err?.message || 'Error al cargar la biblioteca');
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Cargando biblioteca...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadExports}>
          <Text style={styles.retryButtonText}>Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (exports.length === 0) {
    return (
      <EmptyState
        icon="folder-open-outline"
        title="Aún no tienes clips exportados"
        subtitle="Los clips que exportes aparecerán aquí"
      />
    );
  }

  const renderItem = ({ item }: { item: ExportItem }) => (
    <TouchableOpacity
      style={styles.exportCard}
      onPress={() => {
        if (item.outputUrl) {
          router.push(`/project/${item.id}/export?exportId=${item.id}&preset=${item.preset}`);
        }
      }}
    >
      <View style={styles.exportInfo}>
        <Text style={styles.exportName}>{item.projectName}</Text>
        <Text style={styles.exportMeta}>
          {item.preset.toUpperCase()} · {formatDate(item.createdAt)}
        </Text>
      </View>
      <View style={[styles.statusBadge, item.status === 'completed' ? styles.statusCompleted : styles.statusRendering]}>
        <Text style={styles.statusText}>
          {item.status === 'completed' ? 'Listo' : 'Renderizando'}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Biblioteca</Text>
      <FlatList
        data={exports}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#fff',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
  errorText: {
    fontSize: 16,
    color: '#e53e3e',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  list: {
    padding: 16,
  },
  exportCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#f7f7f7',
    borderRadius: 12,
    marginBottom: 12,
  },
  exportInfo: {
    flex: 1,
  },
  exportName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  exportMeta: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  statusCompleted: {
    backgroundColor: '#e6ffea',
  },
  statusRendering: {
    backgroundColor: '#fff3cd',
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
});
