import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { PRESETS } from '../../../lib/constants';
import { api } from '../../../services/api';

type PresetKey = 'tiktok' | 'reels' | 'shorts';

const PRESET_LABELS: Record<PresetKey, string> = {
  tiktok: 'TikTok (1080×1920)',
  reels: 'Instagram Reels (1080×1920)',
  shorts: 'YouTube Shorts (1080×1920)',
};

export default function ExportScreen() {
  const { id, jobId, preset } = useLocalSearchParams<{ id: string; jobId: string; preset: string }>();
  const router = useRouter();
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'>('PENDING');
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId || !id) return;

    const poll = async () => {
      try {
        const result = await api.getExportJob(id, jobId);
        setProgress(result.progress);
        setStatus(result.status as typeof status);

        if (result.status === 'COMPLETED' && result.result?.outputUrl) {
          setOutputUrl(result.result.outputUrl);
        } else if (result.status === 'FAILED') {
          setError('La exportación falló. Intenta de nuevo.');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al obtener el estado de exportación');
      }
    };

    // Poll every 2 seconds
    const interval = setInterval(poll, 2000);
    // Initial poll
    poll();

    return () => clearInterval(interval);
  }, [jobId, id]);

  const handleDownload = async () => {
    if (outputUrl) {
      try {
        await Linking.openURL(outputUrl);
      } catch {
        setError('No se pudo abrir el archivo');
      }
    }
  };

  const isComplete = status === 'COMPLETED';
  const isFailed = status === 'FAILED';
  const isProcessing = status === 'PENDING' || status === 'PROCESSING';

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
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => router.back()}
          >
            <Text style={styles.retryButtonText}>Volver al editor</Text>
          </TouchableOpacity>
        </View>
      ) : isComplete ? (
        <View style={styles.successContainer}>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.successText}>Tu video está listo</Text>
          <TouchableOpacity style={styles.downloadButton} onPress={handleDownload}>
            <Text style={styles.downloadButtonText}>Descargar / Compartir</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.doneButton}
            onPress={() => router.push('/(tabs)/library')}
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
          <Text style={styles.progressText}>
            {status === 'PENDING' ? 'Iniciando...' : `Renderizando... ${progress}%`}
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
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 32,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  presetLabel: {
    fontSize: 16,
    color: '#666',
  },
  progressContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  progressBarContainer: {
    width: '100%',
    height: 8,
    backgroundColor: '#eee',
    borderRadius: 4,
    marginTop: 24,
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
    marginTop: 16,
  },
  successContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  successIcon: {
    fontSize: 64,
    color: '#34C759',
    marginBottom: 16,
  },
  successText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 32,
  },
  downloadButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignItems: 'center',
    width: '100%',
    marginBottom: 12,
  },
  downloadButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  doneButton: {
    backgroundColor: '#f0f0f0',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignItems: 'center',
    width: '100%',
  },
  doneButtonText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '600',
  },
  errorContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  errorText: {
    fontSize: 16,
    color: '#FF3B30',
    textAlign: 'center',
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignItems: 'center',
    width: '100%',
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});
