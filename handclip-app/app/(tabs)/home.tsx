import { useState, useEffect } from 'react';
import { FlatList, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { api, Project } from '../../services/api';
import EmptyState from '../../components/ui/EmptyState';

interface ProjectCardProps {
  project: Project;
  onPress: () => void;
}

function ProjectCard({ project, onPress }: ProjectCardProps) {
  return (
    <TouchableOpacity 
      style={styles.card} 
      onPress={onPress} 
      activeOpacity={0.7}
      accessibilityLabel={`Abrir proyecto ${project.name || 'Proyecto sin nombre'}`}
      accessibilityRole="button"
    >
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {project.name || 'Proyecto sin nombre'}
        </Text>
        <Text style={styles.cardMeta}>
          {project.status ?? 'Sin estado'} · {new Date(project.createdAt).toLocaleDateString()}
        </Text>
      </View>
      <View style={styles.cardArrow}>
        <Text style={styles.arrow}>{'›'}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function HomeTab() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const data = await api.getProjects();
      setProjects(data);
    } catch (err: any) {
      setError(err?.message || 'Error al cargar proyectos');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const handleProjectPress = (projectId: string) => {
    router.push(`/project/${projectId}`);
  };

  const handleRetry = () => {
    loadProjects();
  };

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#007AFF" accessibilityLabel="Cargando proyectos" />
        <Text style={styles.loadingText}>Cargando proyectos...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerContainer}>
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
      <View style={styles.centerContainer}>
        <EmptyState
          icon="folder-outline"
          title="Sin proyectos"
          subtitle="Crea tu primer proyecto para comenzar."
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Proyectos</Text>
      </View>
      <FlatList
        data={projects}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ProjectCard
            project={item}
            onPress={() => handleProjectPress(item.id)}
          />
        )}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshing={isRefreshing}
        onRefresh={() => {
          setIsRefreshing(true);
          loadProjects(true);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  centerContainer: {
    flex: 1,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  list: {
    padding: 16,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9f9f9',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  cardMeta: {
    fontSize: 13,
    color: '#666',
  },
  cardArrow: {
    marginLeft: 8,
  },
  arrow: {
    fontSize: 24,
    color: '#ccc',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#666',
  },
});
