import { Tabs } from 'expo-router';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AppTopBar from '../../components/ui/AppTopBar';
import { useAppTheme } from '../../lib/theme';

const TAB_TITLES: Record<string, string> = {
  home: 'Proyectos',
  library: 'Biblioteca',
  settings: 'Configuración',
};

export default function TabsLayout() {
  const router = useRouter();
  const { theme } = useAppTheme();

  return (
    <Tabs
      screenOptions={({ route }) => ({
        header: () => (
          <AppTopBar
            title={TAB_TITLES[route.name] ?? 'HandClip'}
            rightAction={
              route.name === 'home'
                ? {
                    label: 'Importar',
                    icon: 'cloud-upload-outline',
                    onPress: () => router.push('/import'),
                    accessibilityLabel: 'Importar video',
                  }
                : undefined
            }
          />
        ),
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.muted,
        tabBarStyle: {
          backgroundColor: theme.surfaceElevated,
          borderTopColor: theme.border,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
        sceneStyle: {
          backgroundColor: theme.background,
        },
      })}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Proyectos',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: 'Biblioteca',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="folder" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Configuración',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
