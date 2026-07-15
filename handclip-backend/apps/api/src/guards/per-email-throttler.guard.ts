import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';

interface Bucket {
  count: number;
  resetAt: number;
}

// ponytail: 3 OTP requests per email per hour, blocks email-bombing abuse while
// letting legitimate users retry. In-memory Map → single-instance only.
// Multi-instance: swap the Map for Redis INCR + EXPIRE (key = email, ttl = WINDOW_MS).
@Injectable()
export class PerEmailThrottlerGuard implements CanActivate, OnModuleDestroy {
  private readonly buckets = new Map<string, Bucket>();
  private readonly LIMIT = 3;
  private readonly WINDOW_MS = 60 * 60 * 1000;
  // ponytail: lazy cleanup every 5 min keeps the Map bounded without an external scheduler.
  private cleanupInterval = setInterval(() => this.evictExpired(), 5 * 60 * 1000);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ body?: { email?: unknown }; ip?: string }>();
    const raw = req.body?.email;
    if (typeof raw !== 'string') return true; // no email in body → fall through to per-IP throttler
    const email = raw.toLowerCase().trim();
    if (!email) return true;

    const now = Date.now();
    const bucket = this.buckets.get(email);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(email, { count: 1, resetAt: now + this.WINDOW_MS });
      return true;
    }
    if (bucket.count >= this.LIMIT) {
      throw new HttpException(
        'Too many OTP requests for this email. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    bucket.count++;
    return true;
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupInterval);
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [k, v] of this.buckets) {
      if (v.resetAt <= now) this.buckets.delete(k);
    }
  }
}
