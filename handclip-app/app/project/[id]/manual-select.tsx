import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useProjectStore } from '../../../stores/project.store';

export default function ManualSelectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { currentProject, fetchClips } = useProjectStore();

  const [startTimeInput, setStartTimeInput] = useState('');
  const [endTimeInput, setEndTimeInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const duration = currentProject?.sourceDuration || 0;

  const handleCreateClip = async () => {
    if (!id) return;

    const startTime = parseFloat(startTimeInput);
    const endTime = parseFloat(endTimeInput);

    if (isNaN(startTime) || isNaN(endTime)) {
      Alert.alert('Error', 'Por favor ingresa tiempos válidos en segundos');
      return;
    }

    if (startTime < 0 || endTime < 0) {
      Alert.alert('Error', 'Los tiempos no pueden ser negativos');
      return;
    }

    if (startTime >= endTime) {
      Alert.alert('Error', 'El tiempo de inicio debe ser menor que el tiempo final');
      return;
    }

    if (endTime > duration) {
      Alert.alert('Error', `El tiempo final no puede ser mayor que la duración del video (${duration.toFixed(1)}s)`);
      return;
    }

    setIsLoading(true);
    try {
      const { api } = await import('../../../services/api');
      const result = await api.createManualClip(id, startTime, endTime);
      await fetchClips(id);
      router.push(`/project/${id}/edit?clipId=${result.clipId}`);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo crear el clip');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Selección Manual</Text>
      <Text style={styles.instructions}>
        Ingresa los tiempos de inicio y fin del clip en segundos. Puedes ver el video en la pantalla del proyecto para encontrar los momentos exactos.
      </Text>

      <View style={styles.inputContainer}>
        <Text style={styles.label}>Tiempo de inicio (segundos)</Text>
        <TextInput
          style={styles.input}
          value={startTimeInput}
          onChangeText={setStartTimeInput}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor="#999"
        />
      </View>

      <View style={styles.inputContainer}>
        <Text style={styles.label}>Tiempo de fin (segundos)</Text>
        <TextInput
          style={styles.input}
          value={endTimeInput}
          onChangeText={setEndTimeInput}
          keyboardType="decimal-pad"
          placeholder={duration.toFixed(1)}
          placeholderTextColor="#999"
        />
      </View>

      <Text style={styles.hint}>
        Duración del video: {duration.toFixed(1)} segundos
      </Text>

      <TouchableOpacity
        style={[styles.createButton, isLoading && styles.createButtonDisabled]}
        onPress={handleCreateClip}
        disabled={isLoading}
      >
        <Text style={styles.createButtonText}>
          {isLoading ? 'Creando...' : 'Crear clip'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
  },
  instructions: {
    fontSize: 16,
    color: '#aaa',
    lineHeight: 24,
    marginBottom: 32,
  },
  inputContainer: {
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    color: '#888',
    marginBottom: 8,
    fontWeight: '500',
  },
  input: {
    backgroundColor: '#2a2a2a',
    color: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
    borderWidth: 1,
    borderColor: '#3a3a3a',
  },
  hint: {
    fontSize: 13,
    color: '#666',
    marginBottom: 32,
  },
  createButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  createButtonDisabled: {
    opacity: 0.6,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});