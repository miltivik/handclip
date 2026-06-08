import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async sendPushNotification(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    try {
      const { data: profile } = await this.supabaseService
        .getServiceRoleClient()
        .from('profiles')
        .select('expo_push_token')
        .eq('id', userId)
        .single();

      const pushToken = profile?.expo_push_token;
      if (!pushToken) {
        console.log(`[Notifications] No push token for user ${userId}`);
        return;
      }

      const message = {
        to: pushToken,
        sound: 'default',
        title,
        body,
        data: data || {},
      };

      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(message),
      });
      const result = await response.json();
      console.log(`[Notifications] Push sent to ${userId}:`, JSON.stringify(result));
    } catch (err: any) {
      console.error(`[Notifications] Failed to send push: ${err?.message ?? err}`);
    }
  }
}
