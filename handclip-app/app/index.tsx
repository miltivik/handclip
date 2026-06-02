import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuthStore } from '../stores/auth.store';

export default function IndexScreen() {
  const loading = useAuthStore((state) => state.loading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isAnonymous = useAuthStore((state) => state.isAnonymous);

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#007AFF" accessibilityLabel="Cargando sesion" />
      </View>
    );
  }

  return <Redirect href={isAuthenticated || isAnonymous ? '/(tabs)/home' : '/login'} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
});
