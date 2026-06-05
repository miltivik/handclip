import { useState } from 'react';
import { ActivityIndicator, Alert, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';
import { showAccountRequired } from '../../lib/account-required';
import { validateVideoFile } from '../../lib/validation';
import { useAppTheme } from '../../lib/theme';

export default function ImportScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const isAnonymous = useAuthStore((state) => state.isAnonymous);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickedLocal, setPickedLocal] = useState(false);

  const handlePickLocal = async () => {
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
    const validation = validateVideoFile(fileName, fileSize, duration);
    if (!validation.valid) {
      Alert.alert('Video no válido', validation.error);
      return;
    }
    setPickedLocal(true);
  };

  const handleImportVideo = async () => {
    if (isAnonymous || !isAuthenticated) {
      showAccountRequired();
      return;
    }
    setLoading(true);
    setError(null);
    try {
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
      if (result.canceled || !result.assets[0]) {
        return;
      }
      const asset = result.assets[0];
      const fileName = asset.uri.split('/').pop() || `video_${Date.now()}.mp4`;
      const duration = asset.duration ?? 0;
      const { projectId } = await api.uploadVideoFile({
        uri: asset.uri,
        fileName,
        mimeType: 'video/mp4',
        fileSize: asset.fileSize ?? 0,
      });
      router.push({
        pathname: '/import/processing',
        params: {
          projectId,
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

  const handleLocalPreview = async () => {
    await handlePickLocal();
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.content}>
        <View style={styles.logoGroup}>
          <Image
            source={require('../../assets/logo.png')}
            style={styles.logoMark}
            resizeMode="contain"
            accessibilityLabel="HandClip"
            accessibilityIgnoresInvertColors
          />
          <Text style={[styles.logo, { color: theme.text }]} accessibilityRole="header">
            HandClip
          </Text>
        </View>
        <Text style={[styles.subtitle, { color: theme.muted }]}>
          Encuentra los mejores momentos de tus videos
        </Text>

        {error ? (
          <View style={[styles.errorContainer, { backgroundColor: theme.surface }]}>
            <Text style={[styles.errorText, { color: theme.danger }]} accessibilityRole="alert">
              {error}
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.button, { backgroundColor: theme.primary }, loading && styles.buttonDisabled]}
          onPress={handleImportVideo}
          disabled={loading}
          accessibilityLabel="Importar video"
          accessibilityRole="button"
        >
          {loading ? (
            <ActivityIndicator color={theme.primaryText} />
          ) : (
            <Text style={[styles.buttonText, { color: theme.primaryText }]}>Importar video</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondaryButton, { borderColor: theme.border }]}
          onPress={handleLocalPreview}
          accessibilityLabel="Explorar video local"
          accessibilityRole="button"
        >
          <Text style={[styles.secondaryButtonText, { color: theme.text }]}>
            {pickedLocal ? 'Video local listo' : 'Explorar video local'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  logoGroup: {
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  logoMark: {
    width: 96,
    height: 96,
  },
  logo: {
    fontSize: 36,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 40,
  },
  button: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 8,
    minWidth: 200,
    minHeight: 44,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: '600',
  },
  errorContainer: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 24,
    maxWidth: 300,
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
  },
  secondaryButton: {
    marginTop: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
