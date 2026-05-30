import { Controller, Post, Body } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('push')
  async sendPush(
    @Body() body: { userId: string; title: string; message: string; data?: Record<string, string> },
  ) {
    await this.notificationsService.sendPushNotification(
      body.userId,
      body.title,
      body.message,
      body.data,
    );
    return { success: true };
  }
}