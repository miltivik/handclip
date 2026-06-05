import { Platform } from 'react-native';
import { supabase } from './supabase';

// All expo-notifications imports are dynamic to avoid side-effect errors in Expo Go (SDK 53+)

let handlerSet = false;

async function ensureNotificationHandler() {
  if (handlerSet) return;
  const Notifications = await import('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  handlerSet = true;
}

export async function registerForPushNotifications(userId: string): Promise<string | null> {
  const Notifications = await import('expo-notifications');
  const Device = await import('expo-device');

  if (!Device.isDevice) {
    console.log('[Push] Physical device required for notifications');
    return null;
  }

  await ensureNotificationHandler();

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[Push] Permission not granted');
    return null;
  }

  const tokenData = await Notifications.getExpoPushTokenAsync();
  const token = tokenData.data;

  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  if (userId) {
    const { error } = await supabase
      .from('profiles')
      .update({ expo_push_token: token })
      .eq('id', userId);

    if (error) {
      console.warn('[Push] Failed to store token:', error.message);
    } else {
      console.log('[Push] Token registered for user', userId);
    }
  }

  return token;
}

export async function addNotificationListener(
  onNotification: (notification: import('expo-notifications').Notification) => void,
): Promise<() => void> {
  const Notifications = await import('expo-notifications');
  const sub = Notifications.addNotificationReceivedListener(onNotification);
  return () => sub.remove();
}

export async function addNotificationResponseListener(
  onResponse: (response: import('expo-notifications').NotificationResponse) => void,
): Promise<() => void> {
  const Notifications = await import('expo-notifications');
  const sub = Notifications.addNotificationResponseReceivedListener(onResponse);
  return () => sub.remove();
}