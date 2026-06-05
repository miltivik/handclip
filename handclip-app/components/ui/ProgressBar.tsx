function formatEta(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem > 0 ? `~${m}m ${rem}s` : `~${m}m`;
  }
  return `~${s}s`;
}
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useEffect, useRef } from 'react';

interface ProgressBarProps {
  stage: string;
  percentage: number;
  etaSeconds?: number;
}
export default function ProgressBar({ stage, percentage, etaSeconds }: ProgressBarProps) {
  const animatedWidth = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animatedWidth, {
      toValue: percentage,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [percentage, animatedWidth]);

  const width = animatedWidth.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.container} accessibilityLabel={`Progreso: ${percentage}%`} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percentage }}>
      <View style={styles.labelContainer}>
        <Text style={styles.stage}>{stage}</Text>
        <View style={styles.rightLabel}>
          <Text style={styles.percentage}>{percentage}%</Text>
          {etaSeconds != null && etaSeconds > 0 && percentage < 100 && (
            <Text style={styles.eta}>{formatEta(etaSeconds)}</Text>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  labelContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  stage: {
    fontSize: 14,
    color: '#666',
  },
  rightLabel: {
    alignItems: 'flex-end',
  },
  percentage: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  eta: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  track: {
    height: 8,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 4,
  },
});
