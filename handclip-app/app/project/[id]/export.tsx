import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Share } from 'react-native';
import { PRESETS } from '../../../lib/constants';
import { api } from '../../../services/api';

type PresetKey = 'tiktok' | 'reels' | 'shorts';

const PRESET_LABELS: Record<PresetKey, string> = {
  tiktok: 'TikTok (1080×1920)',
  reels: 'Instagram Reels (1080×1920)',
  shorts: 'YouTube Shorts (1080×1920)',
};

export default function ExportScreen() {
  const { id, jobId, exportId, preset } = useLocalSearchParams<{
    id: string;
    jobId: string;
    exportId: string;
    preset: string;
  }>();
  const router = useRouter();
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'queued' | 'rendering' | 'completed' | 'failed'>('queued');
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollId = exportId || jobId;

  useEffect(() => {
    if (!pollId || !id) return;

    const poll = async () => {
      try {
        const result = await api.getExportJob(pollId);
        setProgress(result.progress);
        setStatus(result.status as typeof status);

        if (result.status === 'completed' && result.outputUrl) {
          setOutputUrl(result.outputUrl);
        } else if (result.status === 'failed') {
          setError('La exportación falló. Intenta de nuevo.');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al obtener el estado de exportación');
      }
    };

    // Poll every 2 seconds
    const interval = setInterval(poll, 2000);
    poll();

    return () => clearInterval(interval);
  }, [pollId, id]);

  const handleDownload = async () => {
    if (outputUrl) {
      try {
        await Share.share({ url: outputUrl, message: 'Mira mi clip creado con HandClip' });
      } catch {
        setError('No se pudo compartir el archivo');
      }
    }
  };

  const isComplete = status === 'completed';
  const isFailed = status === 'failed';
  const isProcessing = status === 'queued' || status === 'rendering';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        {isComplete ? '¡Exportación completa!' : isFailed ? 'Error en exportación' : 'Exportando clip'}
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Preset utilizado</Text>
        <Text style={styles.presetLabel}>
          {PRESET_LABELS[preset as PresetKey] || preset}
        </Text>
      </View>

      {error ? (
        <View style={styles.errorContainer}>
          <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => router.back()}
            accessibilityLabel="Volver al editor"
            accessibilityRole="button"
          >
            <Text style={styles.retryButtonText}>Volver al editor</Text>
          </TouchableOpacity>
        </View>
      ) : isComplete ? (
        <View style={styles.successContainer}>
          <Text accessibilityRole="alert" style={styles.successIcon}>✓</Text>
          <Text accessibilityRole="alert" style={styles.successText}>Tu video está listo</Text>
          <TouchableOpacity 
            style={styles.downloadButton} 
            onPress={handleDownload}
            accessibilityLabel="Descargar clip"
            accessibilityRole="button"
          >
            <Text style={styles.downloadButtonText}>Descargar / Compartir</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.doneButton}
            onPress={() => router.push('/(tabs)/library')}
            accessibilityLabel="Ver en biblioteca"
            accessibilityRole="button"
          >
            <Text style={styles.doneButtonText}>Ver en biblioteca</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.progressContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <View style={styles.progressBarContainer}>
            <View style={[styles.progressBar, { width: `${progress}%` }]} />
          </View>
          <Text accessibilityLabel={`Exportando clip, ${progress}%`} style={styles.progressText}>
            {status === 'queued' ? 'En cola...' : `Renderizando... ${progress}%`}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 24,
    color: '#333',
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  presetLabel: {
    fontSize: 14,
    color: '#333',
  },
  progressContainer: {
    alignItems: 'center',
    marginTop: 40,
  },
  progressBarContainer: {
    width: '100%',
    height: 8,
    backgroundColor: '#eee',
    borderRadius: 4,
    marginTop: 20,
    marginBottom: 16,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 16,
    color: '#666',
  },
  successContainer: {
    alignItems: 'center',
    marginTop: 40,
  },
  successIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  successText: {
    fontSize: 18,
    color: '#333',
    marginBottom: 24,
  },
  downloadButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    marginBottom: 16,
    width: '100%',
  },
  downloadButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  doneButton: {
    backgroundColor: '#f0f0f0',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
  },
  doneButtonText: {
    color: '#333',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorContainer: {
    marginTop: 40,
  },
  errorText: {
    fontSize: 16,
    color: '#ff3b30',
    marginBottom: 16,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});