import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { useState, useEffect } from 'react';

export default function ImportScreen() {
  const { videoUri } = useLocalSearchParams<{ videoUri: string }>();
  const router = useRouter();
  const [videoInfo, setVideoInfo] = useState<{
    duration: number;
    size: number;
    width: number;
    height: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!videoUri) {
      setLoading(false);
      return;
    }

    // Timeout de 5 segundos para evitar loading infinito
    const timeoutId = setTimeout(() => {
      if (loading) {
        setError('No se pudo cargar la información del video. Verifica los permisos.');
        setLoading(false);
      }
    }, 5000);

    // Simulate loading video metadata
    const timer = setTimeout(() => {
      clearTimeout(timeoutId);
      setVideoInfo({
        duration: 180,
        size: 52428800,
        width: 1920,
        height: 1080,
      });
      setLoading(false);
    }, 1000);

    return () => {
      clearTimeout(timer);
      clearTimeout(timeoutId);
    };
  }, [videoUri]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatSize = (bytes: number) => {
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    return `${mb} MB`;
  };

  const handleAnalyze = () => {
    router.push('/import/processing');
  };

  if (!videoUri) {
    return (
      <View style={styles.container}>
        <Text>No video selected</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.thumbnailContainer}>
          <View style={styles.thumbnailPlaceholder}>
            <Text style={styles.thumbnailText}>Video</Text>
          </View>
        </View>

        {loading && !error && (
          <ActivityIndicator size="large" color="#007AFF" style={styles.loader} />
        )}

        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!loading && !error && videoInfo && (
          <View style={styles.metadata}>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Duración</Text>
              <Text style={styles.metaValue}>{formatDuration(videoInfo.duration)}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Tamaño</Text>
              <Text style={styles.metaValue}>{formatSize(videoInfo.size)}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Resolución</Text>
              <Text style={styles.metaValue}>
                {videoInfo.width}x{videoInfo.height}
              </Text>
            </View>
          </View>
        )}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleAnalyze}
          disabled={loading}
        >
          <Text style={styles.buttonText}>Analizar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    padding: 24,
  },
  thumbnailContainer: {
    aspectRatio: 16 / 9,
    backgroundColor: '#f0f0f0',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 24,
  },
  thumbnailPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailText: {
    fontSize: 16,
    color: '#999',
  },
  loader: {
    marginVertical: 24,
  },
  errorContainer: {
    backgroundColor: '#fee',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  errorText: {
    color: '#c00',
    fontSize: 14,
  },
  metadata: {
    backgroundColor: '#f8f8f8',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  metaLabel: {
    fontSize: 16,
    color: '#666',
  },
  metaValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  button: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});