import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface ResolvedUser {
  id: string;
  email?: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ResolvedUser =>
    ctx.switchToHttp().getRequest().user,
);
