import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, StyleSheet, TouchableOpacity, Text, Alert } from 'react-native';
import Preview from '../../../components/editor/Preview';
import Timeline from '../../../components/editor/Timeline';
import { useEditorStore } from '../../../stores/editor.store';
import { api } from '../../../services/api';

export default function EditScreen() {
  const { id, clipId } = useLocalSearchParams<{ id: string; clipId: string }>();
  const router = useRouter();
  const {
    trimStart,
    trimEnd,
    subtitles,
    preset,
    setTrimStart,
    setTrimEnd,
  } = useEditorStore();

  useEffect(() => {
    setTrimStart(0);
    setTrimEnd(15);
  }, [clipId, setTrimStart, setTrimEnd]);

  const handleExport = async () => {
    if (!clipId) {
      Alert.alert('Error', 'No hay un clip seleccionado');
      return;
    }
    try {
      const result = await api.exportClip(id!, {
        clipId,
        trimStart,
        trimEnd,
        subtitles: subtitles.map((s) => ({
          id: (s as { id?: string }).id || '',
          text: s.text,
          startTime: s.startTime,
          endTime: s.endTime,
        })),
        preset,
      });
      router.push(`/project/${id}/export?jobId=${result.jobId}&preset=${preset}`);
    } catch (err) {
      Alert.alert('Error al iniciar exportación', err instanceof Error ? err.message : 'Error desconocido');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.previewContainer}>
        <Preview videoUri="placeholder" subtitles={[]} />
      </View>

      <View style={styles.timelineContainer}>
        <Timeline
          duration={180}
          trimStart={trimStart}
          trimEnd={trimEnd}
          onTrimStartChange={setTrimStart}
          onTrimEndChange={setTrimEnd}
          bRollMarkers={[30, 60, 90]}
        />
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.exportButton} onPress={handleExport}>
          <Text style={styles.exportButtonText}>Exportar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  previewContainer: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  timelineContainer: {
    height: 200,
    backgroundColor: '#2a2a2a',
  },
  footer: {
    padding: 16,
    backgroundColor: '#1a1a1a',
  },
  exportButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  exportButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});
