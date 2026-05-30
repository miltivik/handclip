import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

interface Subtitle {
  text: string;
  startTime: number;
  endTime: number;
}

interface SubtitleOverlayProps {
  subtitles: Subtitle[];
  currentTime: number;
  position?: 'top' | 'bottom';
  onSubtitleTap?: (index: number, text: string, startTime: number, endTime: number) => void;
}

export default function SubtitleOverlay({
  subtitles,
  currentTime,
  position = 'bottom',
  onSubtitleTap,
}: SubtitleOverlayProps) {
  const activeSubtitle = subtitles.find(
    (sub) => currentTime >= sub.startTime && currentTime <= sub.endTime
  );
  const activeIndex = subtitles.findIndex(
    (sub) => currentTime >= sub.startTime && currentTime <= sub.endTime
  );

  if (!activeSubtitle) return null;

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => {
        if (activeIndex >= 0 && onSubtitleTap) {
          onSubtitleTap(activeIndex, activeSubtitle.text, activeSubtitle.startTime, activeSubtitle.endTime);
        }
      }}
    >
      <View style={[styles.container, position === 'top' ? styles.top : styles.bottom]}>
        <View style={styles.background}>
          <Text style={styles.text}>{activeSubtitle.text}</Text>
        </View>
      </View>
    </TouchableOpacity>
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
