import { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import ProgressBar from '../../components/ui/ProgressBar';
import { api, subscribeJobProgress, JobProgress, PollerCallbacks } from '../../services/api';
import { useProjectStore } from '../../stores/project.store';
import { useAuthStore } from '../../stores/auth.store';
import { useJobsStore, newClientRequestId, getOrCreateClientRequestId } from '../../stores/jobs.store';

const STAGES = [
  'Transcribiendo audio...',
  'Analizando contenido...',
  'Generando candidatos...',
];

export default function ProcessingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId: string }>();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isAnonymous = useAuthStore((state) => state.isAnonymous);
  const [stage, setStage] = useState(0);
  const [progress, setProgress] = useState(0);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const jobIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (isAnonymous || !isAuthenticated) {
      setError('Necesitas una cuenta para iniciar el analisis IA.');
      return;
    }
  }, [isAnonymous, isAuthenticated]);

  useEffect(() => {
    if (!params.projectId) {
      setError('Falta parámetro: projectId');
      return;
    }

    const runAnalysis = async () => {
      setStage(0);
      setProgress(0);
      setEtaSeconds(null);
      setOffline(false);
      startedAtRef.current = null;
      try {
        // 1. Generate or reuse idempotency key BEFORE the POST. The request
        //    is persisted immediately so a retry of the same user action
        //    (network drop, double tap, app kill) reuses the same key.
        const clientRequestId = getOrCreateClientRequestId(
          params.projectId!,
          'clip_analysis',
        );
        const { jobId } = await api.analyze(params.projectId!, clientRequestId);
        jobIdRef.current = jobId;

        // 2. Promote the pending request to a pending job. Consume the
        //    request so future taps create a new idempotency key.
        useJobsStore.getState().addJob({
          jobId,
          projectId: params.projectId!,
          type: 'clip_analysis',
          status: 'queued',
          clientRequestId,
        });
        useJobsStore.getState().consumeRequest(clientRequestId);

        // 3. Subscribe to progress. Network errors do NOT abort the poller.
        const callbacks: PollerCallbacks = {
          onProgress: (data: JobProgress, status) => {
            setOffline(status === 'offline');
            if (status === 'offline') return;
            const nextProgress = Math.max(0, Math.min(100, data.progress));
            setProgress(nextProgress);
            if (nextProgress > 0 && !startedAtRef.current) {
              startedAtRef.current = Date.now();
            }
            if (nextProgress > 5 && nextProgress < 100 && startedAtRef.current) {
              const elapsed = (Date.now() - startedAtRef.current) / 1000;
              setEtaSeconds(elapsed > 30 ? Math.ceil((elapsed / nextProgress) * (100 - nextProgress)) : null);
            } else {
              setEtaSeconds(null);
            }
            if (nextProgress >= 66) setStage(2);
            else if (nextProgress >= 33) setStage(1);
          },
          onComplete: (result) => {
            setEtaSeconds(null);
            const data = result as any;
            const clips = data?.segments || data?.returnvalue?.clips || data?.clips;
            if (Array.isArray(clips)) {
              useProjectStore.getState().setClips(clips);
            } else {
              useProjectStore.getState().fetchClips(params.projectId!).catch(() => null);
            }
            useJobsStore.getState().removeJob(jobId);
            router.replace(`/project/${params.projectId}`);
          },
          onError: (err) => {
            const message = err.message ?? '';
            if (
              message.toLowerCase().includes('active provider') ||
              message.toLowerCase().includes('oauth')
            ) {
              setError('Conecta un proveedor IA en Configuracion antes de analizar.');
              setTimeout(() => router.replace('/settings' as any), 500);
              return;
            }
            setError(message);
          },
        };
        unsubscribeRef.current = subscribeJobProgress(jobId, callbacks);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al iniciar análisis');
      }
    };

    runAnalysis();

    return () => {
      unsubscribeRef.current?.();
    };
  }, [params.projectId, router]);

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
        <Text style={styles.stage}>{offline ? 'Sin conexion — reintentando...' : STAGES[stage]}</Text>

        <View style={styles.progressContainer}>
          <ProgressBar
            stage={offline ? 'Esperando conexion' : STAGES[stage]}
            percentage={Math.round(progress)}
            etaSeconds={etaSeconds ?? undefined}
          />
        </View>

        <Text style={styles.hint}>
          {offline
            ? 'El servidor sigue procesando. Te avisaremos al terminar.'
            : 'Esto puede tardar unos minutos...'}
        </Text>
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
    textAlign: 'center',
  },
  error: {
    fontSize: 16,
    color: '#e53935',
    textAlign: 'center',
    marginTop: 16,
  },
});
