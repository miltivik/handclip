import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api, Project } from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';
import { useJobsStore, PendingJob } from '../../stores/jobs.store';
import EmptyState from '../../components/ui/EmptyState';
import { useAppTheme } from '../../lib/theme';

interface ProjectCardProps {
  project: Project;
  onPress: () => void;
}

function ProjectCard({ project, onPress }: ProjectCardProps) {
  const { theme } = useAppTheme();

  return (
    <TouchableOpacity
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityLabel={`Abrir proyecto ${project.name || 'Proyecto sin nombre'}`}
      accessibilityRole="button"
    >
      <View style={styles.cardContent}>
        <Text style={[styles.cardTitle, { color: theme.text }]} numberOfLines={1}>
          {project.name || 'Proyecto sin nombre'}
        </Text>
        <Text style={[styles.cardMeta, { color: theme.muted }]}>
          {project.status ?? 'Sin estado'} · {new Date(project.createdAt).toLocaleDateString()}
        </Text>
      </View>
      <View style={styles.cardArrow}>
        <Text style={[styles.arrow, { color: theme.muted }]}>›</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function HomeTab() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const isAnonymous = useAuthStore((state) => state.isAnonymous);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const jobs = useJobsStore((state) => state.jobs);
  const pendingJobs = useMemo(
    () => jobs.filter(
      (j) => j.status === 'queued' || j.status === 'active' || j.status === 'offline',
    ),
    [jobs],
  );
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(isAuthenticated && !isAnonymous);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAnonymous || !isAuthenticated) {
      setProjects([]);
      setIsLoading(false);
      setError(null);
      return;
    }
    setIsLoading(true);
    api.getProjects()
      .then((data) => {
        setProjects(data);
        setError(null);
      })
      .catch((err: Error) => {
        setError(err?.message || 'Error al cargar proyectos');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [isAnonymous, isAuthenticated]);

  const handleProjectPress = (projectId: string) => {
    router.push(`/project/${projectId}`);
  };

  const handleImportVideo = () => {
    router.push('/import');
  };

  const handleRetry = () => {
    if (!isAuthenticated || isAnonymous) return;
    setIsLoading(true);
    setError(null);
    api.getProjects()
      .then((data) => {
        setProjects(data);
        setError(null);
      })
      .catch((err: Error) => {
        setError(err?.message || 'Error al cargar proyectos');
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  if (!isAuthenticated && !isAnonymous) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.background }]}>
        <EmptyState
          icon="person-outline"
          title="Inicia sesión para continuar"
          subtitle="Crea una cuenta para guardar proyectos y usar análisis IA."
          ctaLabel="Crear cuenta o iniciar sesión"
          onCtaPress={() => router.push('/login')}
        />
      </View>
    );
  }

  if (isAnonymous) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.background }]}>
        <EmptyState
          icon="folder-outline"
          title="Modo exploración"
          subtitle="Crea una cuenta para guardar proyectos y usar análisis IA."
          ctaLabel="Crear cuenta o iniciar sesión"
          onCtaPress={() => router.push('/login')}
        />
        <TouchableOpacity
          style={[styles.importButton, { backgroundColor: theme.primary }]}
          onPress={handleImportVideo}
          accessibilityLabel="Explorar importación"
          accessibilityRole="button"
        >
          <Text style={[styles.importButtonText, { color: theme.primaryText }]}>
            Explorar importación
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.primary} accessibilityLabel="Cargando proyectos" />
        <Text style={[styles.loadingText, { color: theme.muted }]}>Cargando proyectos...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.background }]}>
        <EmptyState
          icon="alert-circle-outline"
          title="Error al cargar"
          subtitle={error}
          ctaLabel="Reintentar"
          onCtaPress={handleRetry}
        />
      </View>
    );
  }

  if (projects.length === 0) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.background }]}>
        <EmptyState
          icon="folder-outline"
          title="Sin proyectos"
          subtitle="Crea tu primer proyecto para comenzar."
          ctaLabel="Importar video"
          onCtaPress={handleImportVideo}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <FlatList
        data={projects}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={pendingJobs.length > 0 ? <PendingJobsBanner jobs={pendingJobs} /> : null}
        renderItem={({ item }) => (
          <ProjectCard
            project={item}
            onPress={() => handleProjectPress(item.id)}
          />
        )}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const JOB_LABELS: Record<PendingJob['type'], string> = {
  clip_analysis: 'Analizando',
  render: 'Renderizando',
  edit_prompt: 'Editando',
};

function PendingJobsBanner({ jobs }: { jobs: PendingJob[] }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  return (
    <View style={[styles.banner, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {jobs.slice(0, 3).map((job) => (
        <TouchableOpacity
          key={job.jobId}
          style={styles.bannerRow}
          onPress={() => {
            if (job.type === 'render') {
              const preset = job.meta?.preset;
              router.push(
                preset
                  ? `/project/${job.projectId}/export?jobId=${job.jobId}&preset=${preset}`
                  : `/project/${job.projectId}/export?jobId=${job.jobId}`,
              );
            } else {
              router.push(`/project/${job.projectId}`);
            }
          }}
          accessibilityRole="button"
        >
          <ActivityIndicator size="small" color={theme.primary} />
          <Text style={[styles.bannerText, { color: theme.text }]}>
            {JOB_LABELS[job.type]}... {job.status === 'offline' ? '(sin conexion)' : `${Math.round(job.progress)}%`}
          </Text>
        </TouchableOpacity>
      ))}
      {jobs.length > 3 ? (
        <Text style={[styles.bannerMore, { color: theme.muted }]}>
          +{jobs.length - 3} más
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  importButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  importButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  list: {
    padding: 16,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  cardMeta: {
    fontSize: 13,
  },
  cardArrow: {
    marginLeft: 8,
  },
  arrow: {
    fontSize: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  banner: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  bannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  bannerText: {
    marginLeft: 8,
    fontSize: 14,
  },
  bannerMore: {
    fontSize: 12,
    marginTop: 4,
  },
});
