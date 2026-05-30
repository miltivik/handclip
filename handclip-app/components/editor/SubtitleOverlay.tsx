import { View, Text, StyleSheet } from 'react-native';

interface Subtitle {
  text: string;
  startTime: number;
  endTime: number;
}

interface SubtitleOverlayProps {
  subtitles: Subtitle[];
  currentTime: number;
  position?: 'top' | 'bottom';
}

export default function SubtitleOverlay({
  subtitles,
  currentTime,
  position = 'bottom',
}: SubtitleOverlayProps) {
  const activeSubtitle = subtitles.find(
    (sub) => currentTime >= sub.startTime && currentTime <= sub.endTime
  );

  if (!activeSubtitle) return null;

  return (
    <View style={[styles.container, position === 'top' ? styles.top : styles.bottom]}>
      <View style={styles.background}>
        <Text style={styles.text}>{activeSubtitle.text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
  },
  top: {
    top: 16,
  },
  bottom: {
    bottom: 40,
  },
  background: {
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 4,
    alignSelf: 'center',
  },
  text: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
  },
});
