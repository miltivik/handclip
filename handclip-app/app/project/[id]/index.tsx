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
    if (id) {
      fetchProject(id);
      fetchClips(id);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Cargando clips...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerContainer}>
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

  if (clips.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <EmptyState
          icon="film-outline"
          title="Sin clips candidatos"
          subtitle="La IA no encontró momentos destacados. Intenta con otro video."
        />
      </View>
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
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1a1a1a',
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
    marginTop: 12,
    fontSize: 14,
    color: '#666',
  },
});
