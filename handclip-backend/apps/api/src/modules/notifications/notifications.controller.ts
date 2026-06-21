import { Controller, Post, Body, ForbiddenException, BadRequestException } from '@nestjs/common';
import { CurrentToken } from '../../decorators/current-token.decorator';
import { CurrentUser } from '../../decorators/current-user.decorator';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { PushNotificationDtoSchema, PushNotificationDto } from '@handclip/shared';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('push')
  async sendPush(
    @Body(new ZodValidationPipe(PushNotificationDtoSchema)) body: PushNotificationDto,
    @CurrentUser() user: { id: string } | undefined,
    @CurrentToken() token: string,
  ) {
    // ponytail: internal-key path (worker) has token === ''; user path has JWT.
    // Internal calls may push to any userId; user calls can only push to themselves.
    const isInternal = token === '';
    const targetUserId = isInternal ? body.userId : user?.id;
    if (!targetUserId) {
      throw new BadRequestException('userId required');
    }
    if (!isInternal && body.userId && body.userId !== user?.id) {
      throw new ForbiddenException('Cannot send push to other users');
    }
    await this.notificationsService.sendPushNotification(
      targetUserId,
      body.title,
      body.message,
      token,
      body.data,
    );
    return { success: true };
  }
}
