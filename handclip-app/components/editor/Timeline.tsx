import { View, StyleSheet, Text } from 'react-native';
import TrimHandles from './TrimHandles';

interface TimelineProps {
  duration: number;
  trimStart: number;
  trimEnd: number;
  onTrimStartChange: (value: number) => void;
  onTrimEndChange: (value: number) => void;
  bRollMarkers?: number[];
}

export default function Timeline({
  duration,
  trimStart,
  trimEnd,
  onTrimStartChange,
  onTrimEndChange,
  bRollMarkers = [],
}: TimelineProps) {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const timelineWidth = 300;
  const pixelsPerSecond = timelineWidth / duration;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.timeText}>{formatTime(trimStart)}</Text>
        <Text style={styles.durationText}>
          Duración: {formatTime(trimEnd - trimStart)}
        </Text>
        <Text style={styles.timeText}>{formatTime(trimEnd)}</Text>
      </View>

      <View style={styles.timelineContainer}>
        <View style={styles.track}>
          {/* B-roll markers */}
          {bRollMarkers.map((time, index) => (
            <View
              key={index}
              style={[
                styles.bRollMarker,
                { left: time * pixelsPerSecond },
              ]}
            />
          ))}

          {/* Trim selection */}
          <View
            style={[
              styles.trimSelection,
              {
                left: trimStart * pixelsPerSecond,
                width: (trimEnd - trimStart) * pixelsPerSecond,
              },
            ]}
          />

          {/* Trim handles */}
          <TrimHandles
            trimStart={trimStart}
            trimEnd={trimEnd}
            duration={duration}
            pixelsPerSecond={pixelsPerSecond}
            onTrimStartChange={onTrimStartChange}
            onTrimEndChange={onTrimEndChange}
          />
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Arrastra los extremos para ajustar</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  timeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  durationText: {
    color: '#888',
    fontSize: 14,
  },
  timelineContainer: {
    alignItems: 'center',
  },
  track: {
    height: 60,
    width: 300,
    backgroundColor: '#444',
    borderRadius: 4,
    position: 'relative',
  },
  bRollMarker: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: '#ffd700',
  },
  trimSelection: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 122, 255, 0.4)',
    borderWidth: 2,
    borderColor: '#007AFF',
    borderRadius: 4,
  },
  footer: {
    marginTop: 16,
    alignItems: 'center',
  },
  footerText: {
    color: '#888',
    fontSize: 12,
  },
});
