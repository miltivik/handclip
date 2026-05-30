import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { useState, useEffect } from 'react';

export default function ImportScreen() {
  const { videoUri } = useLocalSearchParams<{ videoUri: string }>();
  const router = useRouter();
  const [videoInfo, setVideoInfo] = useState<{
    duration: number;
    width: number;
    height: number;
    size: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Simulate getting video metadata
    if (videoUri) {
      setTimeout(() => {
        setVideoInfo({
          duration: 120,
          width: 1920,
          height: 1080,
          size: 50 * 1024 * 1024,
        });
        setLoading(false);
      }, 1000);
    }
  }, [videoUri]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleAnalyze = () => {
    router.push('/import/processing');
  };

  if (!videoUri) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>No se proporcionó un video</Text>
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
          accessibilityLabel="Analizar video"
          accessibilityRole="button"
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
    paddingTop: 60,
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
    padding: 16,
    backgroundColor: '#fee',
    borderRadius: 8,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 16,
    color: '#ff3b30',
    textAlign: 'center',
  },
  metadata: {
    marginBottom: 24,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
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
    color: '#333',
  },
  button: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    borderRadius: 12,
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
});