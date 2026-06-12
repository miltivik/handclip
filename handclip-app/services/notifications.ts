import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// Show notifications even when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotifications(userId: string): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('[Push] Physical device required for notifications');
    return null;
  }

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

  // Store token in profiles
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

export function addNotificationListener(
  onNotification: (notification: Notifications.Notification) => void,
): () => void {
  const sub = Notifications.addNotificationReceivedListener(onNotification);
  return () => sub.remove();
}

export function addNotificationResponseListener(
  onResponse: (response: Notifications.NotificationResponse) => void,
): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener(onResponse);
  return () => sub.remove();
}
