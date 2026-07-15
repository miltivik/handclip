import { ForbiddenException } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushNotificationDto } from '@handclip/shared';

// Mock the downstream service; we only exercise the authz branch here.
const mockService = {
  sendPushNotification: jest.fn(),
} as unknown as NotificationsService;

describe('NotificationsController.sendPush — internal vs user authz', () => {
  const controller = new NotificationsController(mockService);

  it('throws ForbiddenException when a non-internal user targets another userId', async () => {
    const user = { id: 'u1', role: 'user' };
    const body: PushNotificationDto = {
      userId: 'someone-else',
      title: 'Hi',
      message: 'There',
    };
    await expect(controller.sendPush(body, user, 'tok')).rejects.toThrow(ForbiddenException);
  });
});
