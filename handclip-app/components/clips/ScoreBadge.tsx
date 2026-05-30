import { View, Text, StyleSheet } from 'react-native';

interface ScoreBadgeProps {
  score: number;
}

export default function ScoreBadge({ score }: ScoreBadgeProps) {
  const getColor = () => {
    if (score >= 67) return '#22c55e';
    if (score >= 34) return '#eab308';
    return '#ef4444';
  };

  const getLabel = () => {
    if (score >= 67) return 'High';
    if (score >= 34) return 'Med';
    return 'Low';
  };

  return (
    <View style={[styles.container, { backgroundColor: getColor() }]}>
      <Text style={styles.score}>{score}</Text>
      <Text style={styles.label}>{getLabel()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  score: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  label: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '500',
  },
});
