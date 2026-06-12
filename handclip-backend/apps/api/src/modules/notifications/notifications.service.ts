import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async sendPushNotification(userId: string, title: string, body: string, token?: string, data?: Record<string, string>) {
    // Get user's Expo push token from profiles
    const client = token
      ? this.supabaseService.getClientWithAuth(token)
      : this.supabaseService.getClient();
    const { data: profile } = await client
      .from('profiles')
      .select('expo_push_token')
      .eq('id', userId)
      .single();

    const pushToken = profile?.expo_push_token;
    if (!pushToken) {
      console.log(`[Notifications] No push token for user ${userId}`);
      return;
    }

    // Send via Expo Push API
    const message = {
      to: pushToken,
      sound: 'default',
      title,
      body,
      data: data || {},
    };

    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(message),
      });
      const result = await response.json();
      console.log(`[Notifications] Push sent to ${userId}:`, JSON.stringify(result));
    } catch (err: any) {
      console.error(`[Notifications] Failed to send push: ${err.message}`);
    }
  }
}