import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useProjectStore } from '../../../stores/project.store';
import { api } from '../../../services/api';

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
      Alert.alert('Error', 'Ingresa tiempos válidos en segundos');
      return;
    }

    if (startTime < 0 || endTime < 0) {
      Alert.alert('Error', 'Los tiempos no pueden ser negativos');
      return;
    }

    if (startTime >= endTime) {
      Alert.alert('Error', 'El tiempo de inicio debe ser menor que el tiempo de fin');
      return;
    }

    if (endTime > duration) {
      Alert.alert('Error', `El tiempo de fin no puede ser mayor que la duración del video (${duration.toFixed(1)}s)`);
      return;
    }

    setIsLoading(true);
    try {
      await api.createManualClip(id, startTime, endTime);
      await fetchClips(id);
      router.back();
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
          accessibilityLabel="Tiempo de inicio en segundos"
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
          accessibilityLabel="Tiempo de fin en segundos"
        />
      </View>

      <Text style={styles.hint}>
        Duración del video: {duration.toFixed(1)} segundos
      </Text>

      <TouchableOpacity
        style={[styles.createButton, isLoading && styles.createButtonDisabled]}
        onPress={handleCreateClip}
        disabled={isLoading}
        accessibilityLabel="Crear clip manual"
        accessibilityRole="button"
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
    backgroundColor: '#fff',
    padding: 24,
    paddingTop: 60,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 16,
  },
  instructions: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 32,
  },
  inputContainer: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
    fontSize: 18,
    color: '#333',
  },
  hint: {
    fontSize: 14,
    color: '#999',
    marginBottom: 32,
  },
  createButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    borderRadius: 12,
  },
  createButtonDisabled: {
    opacity: 0.6,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
});