import { View, StyleSheet, Text } from 'react-native';
import SubtitleOverlay from './SubtitleOverlay';

interface Subtitle {
  text: string;
  startTime: number;
  endTime: number;
}

interface PreviewProps {
  videoUri: string;
  subtitles: Subtitle[];
  currentTime?: number;
}
export default function Preview({ videoUri, subtitles, currentTime = 0 }: PreviewProps) {
  const isPlaceholder = !videoUri || videoUri === 'placeholder';

  return (
    <View style={styles.container}>
      {isPlaceholder ? (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>Video Preview (9:16)</Text>
        </View>
      ) : (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>Loading video...</Text>
        </View>
      )}

      {subtitles.length > 0 && (
        <SubtitleOverlay
          subtitles={subtitles}
          currentTime={currentTime}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    aspectRatio: 9 / 16,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 400,
  },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
  placeholderText: {
    color: '#666',
    fontSize: 16,
  },
});
