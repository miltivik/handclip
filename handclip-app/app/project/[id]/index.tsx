import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, FlatList, StyleSheet, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useEffect } from 'react';
import CandidateCard from '../../../components/clips/CandidateCard';
import EmptyState from '../../../components/ui/EmptyState';
import { useProjectStore } from '../../../stores/project.store';
import { ClipCandidate } from '../../../services/api';

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { clips, fetchClips, fetchProject, isLoading, error } = useProjectStore();

  useEffect(() => {
    if (id) {
      fetchProject(id);
      fetchClips(id);
    }
  }, [id, fetchProject, fetchClips]);

  const handleRetry = () => {
    router.replace(`/import/processing?projectId=${id}`);
  };

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text accessibilityLabel="Cargando clips candidatos" style={styles.loadingText}>
          Cargando clips candidatos...
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
          <Text style={styles.retryButtonText}>Reintentar análisis</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (clips.length === 0) {
    return (
      <EmptyState
        icon="cut-outline"
        title="No se encontraron clips"
        subtitle="No se detectaron momentos destacados en el video."
        ctaLabel="Importar otro video"
        onCtaPress={() => router.push('/import')}
      />
    );
  }

  const handleEdit = (candidateId: string) => {
    router.push(`/project/${id}/edit?clipId=${candidateId}`);
  };

  const renderItem = ({ item }: { item: ClipCandidate }) => (
    <CandidateCard
      candidate={item}
      onEdit={() => handleEdit(item.id)}
    />
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Candidatos</Text>
        <Text style={styles.subtitle}>
          {clips.length} clips encontrados
        </Text>
      </View>

      <FlatList
        data={clips}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />
      <TouchableOpacity
        style={styles.manualButton}
        onPress={() => router.push(`/project/${id}/manual-select`)}
        accessibilityLabel="Seleccionar rango manualmente"
        accessibilityRole="button"
      >
        <Text style={styles.manualButtonText}>Seleccionar manualmente</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  header: {
    padding: 16,
    paddingTop: 60,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  list: {
    padding: 16,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  errorText: {
    fontSize: 16,
    color: '#ff3b30',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
  },
  manualButton: {
    backgroundColor: '#f0f0f0',
    margin: 16,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  manualButtonText: {
    color: '#333',
    fontSize: 16,
    fontWeight: '600',
  },
});