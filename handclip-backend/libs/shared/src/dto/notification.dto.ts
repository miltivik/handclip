import { z } from 'zod';

export const PushNotificationDtoSchema = z.object({
  userId: z.string().uuid().optional(),
  title: z.string().min(1).max(100),
  message: z.string().min(1).max(500),
  data: z.record(z.string()).optional(),
});

export type PushNotificationDto = z.infer<typeof PushNotificationDtoSchema>;
