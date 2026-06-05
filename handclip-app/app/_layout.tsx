import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { router } from 'expo-router';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuthStore } from '../stores/auth.store';
import { useAppTheme } from '../lib/theme';

function AuthProvider({ children }: { children: React.ReactNode }) {
  const initAuth = useAuthStore((state) => state.initAuth);
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    const unsubscribe = initAuth();
    return unsubscribe;
  }, [initAuth]);

  useEffect(() => {
    if (!user?.id || Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
      return;
    }

    import('../services/notifications').then(({ registerForPushNotifications }) => {
      registerForPushNotifications(user.id);
    });
  }, [user?.id]);

  useEffect(() => {
    if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
      return; // expo-notifications push removed from Expo Go SDK 53+
    }
    let sub: { remove(): void } | undefined;
    import('expo-notifications').then((Notifications) => {
      sub = Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data;
        if (data?.projectId) {
          router.push(`/project/${data.projectId}`);
        }
      });
    });
    return () => { sub?.remove(); };
  }, []);

  return children;
}

export default function RootLayout() {
  const { isDark } = useAppTheme();

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <Stack screenOptions={{ headerShown: false }} />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
