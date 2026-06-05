import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuthStore } from '../stores/auth.store';
import { getHasSeenOnboarding } from '../lib/onboarding';

export default function IndexScreen() {
  const loading = useAuthStore((state) => state.loading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isAnonymous = useAuthStore((state) => state.isAnonymous);
  const user = useAuthStore((state) => state.user);
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;

    async function checkOnboarding() {
      const seen = await getHasSeenOnboarding();
      if (active) setHasSeenOnboarding(seen);
    }

    if (!loading) {
      void checkOnboarding();
    }

    return () => {
      active = false;
    };
  }, [loading, user]);

  if (loading || hasSeenOnboarding === null) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#007AFF" accessibilityLabel="Cargando sesión" />
      </View>
    );
  }

  if (!hasSeenOnboarding) {
    return <Redirect href="/onboarding" />;
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
