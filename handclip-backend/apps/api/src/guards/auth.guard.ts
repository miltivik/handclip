import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'crypto';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SupabaseService } from '../modules/supabase/supabase.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly supabaseService: SupabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();

    // Allow internal API key as alternative auth (for worker→API calls).
    // Use timingSafeEqual to prevent length/content timing leakage.
    const internalKey = request.headers['x-internal-api-key'] as string | undefined;
    const configuredKey = process.env.INTERNAL_API_KEY;
    if (configuredKey && internalKey && safeEqual(internalKey, configuredKey)) {
      request.user = { id: 'worker', role: 'internal' };
      request.token = '';
      return true;
    }

    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('Missing authorization header');
    }

    const [type, token] = authHeader.split(' ');

    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException(
        'Invalid authorization format. Expected: Bearer <token>',
      );
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .auth.getUser(token);

    if (error || !data.user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    request.user = data.user;
    request.token = token;
    return true;
  }
}

function safeEqual(a: string, b: string): boolean {
  // Constant-time comparison: normalize length, then compare buffers.
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    // Still do a dummy compare so total time doesn't reveal length alone.
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}
