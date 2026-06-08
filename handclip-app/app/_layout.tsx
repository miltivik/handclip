import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { router } from 'expo-router';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuthStore } from '../stores/auth.store';
import { useAppTheme } from '../lib/theme';
import { useResumeActiveJobs } from '../hooks/useResumeActiveJobs';

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
        const data = response.notification.request.content.data as
          | { projectId?: string; jobId?: string; type?: string }
          | undefined;
        if (data?.projectId) {
          const projectId = data.projectId;
          // For analysis/edit-prompt jobs, deep-link to the project page
          // (which fetches the latest state). For render jobs, link to the
          // project's library if we have an exportId, else project root.
          if (data.type === 'export_complete' && data.jobId) {
            router.push(`/project/${projectId}/export?jobId=${data.jobId}`);
          } else {
            router.push(`/project/${projectId}`);
          }
        }
      });
    });
    return () => { sub?.remove(); };
  }, []);

  // Resume any in-flight jobs (server-side continuity).
  useResumeActiveJobs();

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
