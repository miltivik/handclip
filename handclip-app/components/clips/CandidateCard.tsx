import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import ScoreBadge from './ScoreBadge';
import { ClipCandidate } from '../../services/api';

interface CandidateCardProps {
  candidate: ClipCandidate;
  onEdit: () => void;
}

export default function CandidateCard({ candidate, onEdit }: CandidateCardProps) {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const duration = candidate.duration ?? (candidate.endTime - candidate.startTime);

  return (
    <View style={styles.container} accessible={true} accessibilityLabel={`Clip de ${Math.floor(candidate.startTime)}s a ${Math.floor(candidate.endTime)}s, puntuación ${candidate.confidenceScore}`}>
      <View style={styles.thumbnailContainer}>
        <View style={styles.thumbnailPlaceholder}>
          <Text style={styles.thumbnailPlaceholderText}>Preview</Text>
        </View>
        <View style={styles.scoreBadgeContainer}>
          <ScoreBadge score={candidate.confidenceScore} />
        </View>
        <View style={styles.durationBadge}>
          <Text style={styles.durationText}>{formatTime(duration)}</Text>
        </View>
      </View>

      <View style={styles.info}>
        <View style={styles.timeRow}>
          <Text style={styles.timeLabel}>Inicio</Text>
          <Text style={styles.timeValue}>{formatTime(candidate.startTime)}</Text>
        </View>

        <View style={styles.reasonsContainer}>
          {candidate.reasons.map((reason, index) => (
            <View key={index} style={styles.chip}>
              <Text style={styles.chipText}>{reason}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity style={styles.editButton} onPress={onEdit} accessibilityLabel="Editar clip" accessibilityRole="button">
          <Text style={styles.editButtonText}>Editar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f8f8f8',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  thumbnailContainer: {
    height: 160,
    backgroundColor: '#e0e0e0',
    position: 'relative',
  },
  thumbnailPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailPlaceholderText: {
    fontSize: 14,
    color: '#999',
  },
  scoreBadgeContainer: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  durationBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  durationText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  info: {
    padding: 16,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  timeLabel: {
    fontSize: 14,
    color: '#666',
  },
  timeValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  reasonsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  chip: {
    backgroundColor: '#e8f0ff',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 8,
    marginBottom: 8,
  },
  chipText: {
    fontSize: 12,
    color: '#0066cc',
  },
  editButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  editButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
