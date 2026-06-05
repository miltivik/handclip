import { View, Text, StyleSheet } from 'react-native';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';

export default function OfflineBanner() {
  const isOffline = useNetworkStatus();
  if (!isOffline) return null;
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.text}>Sin conexion. Mostrando datos guardados.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: '#FFF3CD', paddingVertical: 6, paddingHorizontal: 12, alignItems: 'center' },
  text: { fontSize: 13, color: '#856404' },
});