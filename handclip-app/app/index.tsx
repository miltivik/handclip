import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../services/api';
import { validateVideoFile } from '../lib/validation';

export default function HomeScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImportVideo = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permissionResult.granted) {
      setError('Se requieren permisos para acceder a la biblioteca de medios');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsEditing: false,
      quality: 1,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    const fileName = asset.uri.split('/').pop() || `video_${Date.now()}.mp4`;
    const fileSize = asset.fileSize ?? 0;
    const duration = asset.duration ?? 0;

    // Validate before uploading
    const validation = validateVideoFile(fileName, fileSize, duration);
    if (!validation.valid) {
      Alert.alert('Video no válido', validation.error);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Upload video via multipart to get videoUrl + projectId
      const { videoUrl, projectId } = await api.uploadVideoFile(asset.uri, fileName);

      // 2. Navigate to processing with real metadata
      router.push({
        pathname: '/import/processing',
        params: {
          projectId,
          videoUrl: encodeURIComponent(videoUrl),
          duration: String(Math.round(duration)),
          width: String(asset.width ?? 0),
          height: String(asset.height ?? 0),
        },
      });

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al subir el video');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.logo}>HandClip</Text>
        <Text style={styles.subtitle}>Encuentra los mejores momentos de tus videos</Text>

        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText} accessibilityRole="alert">{error}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleImportVideo}
          disabled={loading}
          accessibilityLabel="Importar video"
          accessibilityRole="button"
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Importar video</Text>
          )}
        </TouchableOpacity>
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
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  logo: {
    fontSize: 42,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 40,
  },
  button: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
    minWidth: 200,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  errorContainer: {
    backgroundColor: '#ffebee',
    padding: 12,
    borderRadius: 8,
    marginBottom: 24,
    maxWidth: 300,
  },
  errorText: {
    color: '#c62828',
    fontSize: 14,
    textAlign: 'center',
  },
});
