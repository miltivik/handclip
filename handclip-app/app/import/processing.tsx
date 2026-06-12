import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import ProgressBar from '../../components/ui/ProgressBar';
import { api, JobProgress } from '../../services/api';
import { useProjectStore } from '../../stores/project.store';

const STAGES = [
  'Transcribiendo audio...',
  'Analizando contenido...',
  'Generando candidatos...',
];

export default function ProcessingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId: string; videoUrl: string }>();
  const [stage, setStage] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params.projectId || !params.videoUrl) {
      setError('Faltan parámetros del proyecto');
      return;
    }

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    const runAnalysis = async () => {
      try {
        const { analysisJobId } = await api.analyze(params.projectId!, params.videoUrl!);
        if (cancelled) return;

        // Poll job status every 2s (EventSource not available on React Native)
        interval = setInterval(async () => {
          try {
            const job = await api.getJobStatus(analysisJobId);
            if (cancelled) return;

            setProgress(job.progress);
            if (job.progress >= 66) setStage(2);
            else if (job.progress >= 33) setStage(1);

            if (job.status === 'completed' || job.status === 'COMPLETED') {
              clearInterval(interval);
              const returnvalue = job.returnvalue ?? job.result;
              const clips = Array.isArray(returnvalue?.clips) ? returnvalue.clips : undefined;
              if (clips) {
                useProjectStore.getState().setClips(clips);
              }
              router.replace(`/project/${params.projectId}`);
            } else if (job.status === 'failed' || job.status === 'FAILED') {
              clearInterval(interval);
              setError(job.failedReason || 'El análisis falló');
            }
          } catch {
            // Ignore individual poll errors, keep trying
          }
        }, 2000);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al iniciar análisis');
        }
      }
    };

    runAnalysis();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [params.projectId, params.videoUrl, router]);

  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.title}>Error</Text>
          <Text style={styles.error}>{error}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Procesando video</Text>
        <Text style={styles.stage}>{STAGES[stage]}</Text>

        <View style={styles.progressContainer}>
          <ProgressBar
            stage={STAGES[stage]}
            percentage={Math.round(progress)}
          />
        </View>

        <Text style={styles.hint}>Esto puede tardar unos minutos...</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    width: '100%',
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  stage: {
    fontSize: 16,
    color: '#666',
    marginBottom: 40,
  },
  progressContainer: {
    width: '100%',
    marginBottom: 24,
  },
  hint: {
    fontSize: 14,
    color: '#999',
  },
  error: {
    fontSize: 16,
    color: '#e53935',
    textAlign: 'center',
    marginTop: 16,
  },
});
