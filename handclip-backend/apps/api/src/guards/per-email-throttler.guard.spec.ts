import { ExecutionContext, HttpException } from '@nestjs/common';
import { PerEmailThrottlerGuard } from './per-email-throttler.guard';

// ExecutionContext is abstract; we only exercise switchToHttp().getRequest(),
// so a partial object cast is sufficient.
const makeCtx = (email: string | undefined): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ body: { email } }),
    }),
  }) as unknown as ExecutionContext;

describe('PerEmailThrottlerGuard', () => {
  let guard: PerEmailThrottlerGuard;

  beforeEach(() => {
    guard = new PerEmailThrottlerGuard();
  });

  afterEach(() => {
    guard.onModuleDestroy();
  });

  it('allows 3 OTP requests per email per hour, blocks the 4th with 429', () => {
    const ctx = makeCtx('victim@example.com');
    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(() => guard.canActivate(ctx)).toThrow(HttpException);
  });

  it('isolates buckets between distinct emails', () => {
    const ctxA = makeCtx('a@example.com');
    const ctxB = makeCtx('b@example.com');
    for (let i = 0; i < 3; i++) guard.canActivate(ctxA);
    expect(() => guard.canActivate(ctxA)).toThrow(HttpException);
    // b is independent
    expect(guard.canActivate(ctxB)).toBe(true);
  });

  it('passes through when request body has no email (per-IP throttler handles)', () => {
    expect(guard.canActivate(makeCtx(undefined))).toBe(true);
  });
});
