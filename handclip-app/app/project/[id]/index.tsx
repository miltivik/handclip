import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, FlatList, StyleSheet, Text, ActivityIndicator, TouchableOpacity, TextInput } from 'react-native';
import { useEffect, useState, useMemo } from 'react';
import CandidateCard from '../../../components/clips/CandidateCard';
import EmptyState from '../../../components/ui/EmptyState';
import { useProjectStore } from '../../../stores/project.store';
import { ClipCandidate } from '../../../services/api';

function clipMatchesQuery(clip: ClipCandidate, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (clip.transcriptSnippet?.toLowerCase().includes(q)) return true;
  if (clip.suggestedCaption?.toLowerCase().includes(q)) return true;
  if (clip.reasons?.some(r => r.toLowerCase().includes(q))) return true;
  if (clip.moodTags?.some(t => t.toLowerCase().includes(q))) return true;
  return false;
}

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { clips, fetchClips, fetchProject, isLoading, error, currentProject } = useProjectStore();
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const isCurrentCachedProject = currentProject?.id === id;
  const displayedClips = isCurrentCachedProject ? clips : [];

  useEffect(() => {
    if (id) {
      fetchProject(id);
      fetchClips(id);
    }
  }, [id, fetchProject, fetchClips]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchInput.trim().toLowerCase());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const filteredClips = useMemo(() => displayedClips.filter(c => clipMatchesQuery(c, debouncedQuery)), [displayedClips, debouncedQuery]);
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

  if (error && !isCurrentCachedProject) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
          <Text style={styles.retryButtonText}>Reintentar análisis</Text>
        </TouchableOpacity>
      </View>
    );
  }
  // Show cached clips on error for the current project
  if (isCurrentCachedProject && error) {
    // Fall through to cached data rendering
  }

  if (displayedClips.length === 0) {
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

  const subtitleText = debouncedQuery
    ? `${filteredClips.length} de ${displayedClips.length} clips`
    : `${displayedClips.length} clips candidatos`;
  const showNoResults = displayedClips.length > 0 && debouncedQuery && filteredClips.length === 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Candidatos</Text>
        <Text style={styles.subtitle}>{subtitleText}</Text>
      </View>

      <TextInput
        style={styles.searchInput}
        placeholder="Buscar por texto, razón o mood..."
        placeholderTextColor="#999"
        value={searchInput}
        onChangeText={setSearchInput}
        accessibilityLabel="Buscar clips"
      />

      {showNoResults ? (
        <View style={styles.noResultsContainer}>
          <Text style={styles.noResultsTitle}>Sin resultados</Text>
          <Text style={styles.noResultsSubtitle}>Intenta con otro término de búsqueda</Text>
        </View>
      ) : (
        <FlatList
          data={filteredClips}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}

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
  searchInput: {
    backgroundColor: '#f5f5f5',
    marginHorizontal: 16,
    marginBottom: 12,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    fontSize: 16,
    color: '#333',
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
  noResultsContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  noResultsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  noResultsSubtitle: {
    fontSize: 14,
    color: '#666',
  },
});