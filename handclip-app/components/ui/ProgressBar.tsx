import { View, Text, StyleSheet, Animated } from 'react-native';
import { useEffect, useRef } from 'react';

interface ProgressBarProps {
  stage: string;
  percentage: number;
}

export default function ProgressBar({ stage, percentage }: ProgressBarProps) {
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
        <Text style={styles.percentage}>{percentage}%</Text>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { width }]} />
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
  percentage: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
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
