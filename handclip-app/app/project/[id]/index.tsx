import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, FlatList, StyleSheet, Text } from 'react-native';
import { useEffect } from 'react';
import CandidateCard from '../../../components/clips/CandidateCard';
import { useProjectStore } from '../../../stores/project.store';
import { ClipCandidate } from '../../../services/api';

const DEMO_CANDIDATES: ClipCandidate[] = [
  {
    id: 'demo-1',
    startTime: 15,
    endTime: 27,
    duration: 12,
    confidenceScore: 92,
    reasons: ['high_energy', 'emotional_peak'],
    suggestedCaption: 'Demo clip — reemplazar con datos reales',
  },
];

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { clips, fetchClips, isLoading } = useProjectStore();

  useEffect(() => {
    if (id) {
      fetchClips(id);
    }
  }, [id, fetchClips]);

  const displayClips = clips.length > 0 ? clips : DEMO_CANDIDATES;

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
          {isLoading ? 'Cargando clips...' : `${displayClips.length} clips encontrados`}
        </Text>
      </View>

      <FlatList
        data={displayClips}
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
});
