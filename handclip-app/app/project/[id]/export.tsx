import { useEffect, useState, useRef } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { PRESETS } from '../../../lib/constants';
import { api, subscribeJobProgress, PollerCallbacks, JobProgress } from '../../../services/api';
import { useJobsStore, newClientRequestId } from '../../../stores/jobs.store';
import { useProjectStore } from '../../../stores/project.store';

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
  const [status, setStatus] = useState<'QUEUED' | 'ACTIVE' | 'COMPLETED' | 'FAILED'>('QUEUED');
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Register the job in the persisted store (idempotent — no-op if already
  // there from app/import/processing or another call site).
  useEffect(() => {
    if (!jobId || !id) return;
    useJobsStore.getState().addJob({
      jobId,
      projectId: id,
      type: 'render',
      status: 'queued',
      progress: 0,
      meta: preset ? { preset } : undefined,
    });
  }, [jobId, id, preset]);

  useEffect(() => {
    if (!jobId || !id) return;
    const callbacks: PollerCallbacks = {
      onProgress: (data: JobProgress, s) => {
        setOffline(s === 'offline');
        if (s === 'offline') return;
        setProgress(data.progress);
        setStatus(data.status as typeof status);
        if (data.status === 'COMPLETED') {
          const url = data.result?.outputUrl ?? (data.result?.output_url as string | undefined);
          if (typeof url === 'string') setOutputUrl(url);
          if (id) {
            useProjectStore.getState().fetchProject(id).catch(() => null);
          }
        } else if (data.status === 'FAILED') {
          setError('La exportación falló. Intenta de nuevo.');
        }
      },
      onComplete: (result) => {
        setStatus('COMPLETED');
        const url = (result as { outputUrl?: string; output_url?: string } | undefined)?.outputUrl
          ?? (result as { output_url?: string } | undefined)?.output_url;
        if (typeof url === 'string') setOutputUrl(url);
        if (id) useProjectStore.getState().fetchProject(id).catch(() => null);
      },
      onError: (err) => {
        setError(err.message || 'La exportación falló.');
        setStatus('FAILED');
      },
    };
    unsubscribeRef.current = subscribeJobProgress(jobId, callbacks);
    return () => {
      unsubscribeRef.current?.();
    };
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
  const isProcessing = status === 'QUEUED' || status === 'ACTIVE';

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
            {offline
              ? 'Sin conexion — reintentando...'
              : status === 'QUEUED'
                ? 'Iniciando...'
                : `Renderizando... ${progress}%`}
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
