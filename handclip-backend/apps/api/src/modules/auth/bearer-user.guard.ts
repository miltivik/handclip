import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class BearerUserGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header = request.headers?.authorization;
    const token = typeof header === 'string' ? header.match(/^Bearer (.+)$/)?.[1] : undefined;
    if (!token) {
      throw new UnauthorizedException('Bearer token required');
    }
    const { data, error } = await this.supabase.getClient().auth.getUser(token);
    if (error || !data?.user) {
      throw new UnauthorizedException('Invalid bearer token');
    }
    request.user = data.user;
    return true;
  }
}
