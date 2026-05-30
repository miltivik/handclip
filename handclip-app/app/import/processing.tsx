import { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import ProgressBar from '../../components/ui/ProgressBar';
import { api, subscribeJobProgress, ClipCandidate } from '../../services/api';
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
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!params.projectId || !params.videoUrl) {
      setError('Faltan parámetros: projectId o videoUrl');
      return;
    }

    const runAnalysis = async () => {
      try {
        // 1. Iniciar análisis
        const { jobId } = await api.analyze(params.projectId!, params.videoUrl!);

        // 2. Suscribirse al progreso vía SSE
        unsubscribeRef.current = subscribeJobProgress(
          jobId,
          (data) => {
            // Actualizar progreso según el estado
            setProgress(data.progress);

            if (data.progress >= 66) setStage(2);
            else if (data.progress >= 33) setStage(1);
          },
          (result) => {
            // Job completado: guardar clips y navegar
            const data = result as any;
            const clips = data?.segments || data?.returnvalue?.clips;
            if (Array.isArray(clips)) {
              useProjectStore.getState().setClips(clips);
            }
            router.replace(`/project/${params.projectId}`);
          },
          (err) => {
            // Error en SSE
            setError(err.message);
          },
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al iniciar análisis');
      }
    };

    runAnalysis();

    return () => {
      unsubscribeRef.current?.();
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
