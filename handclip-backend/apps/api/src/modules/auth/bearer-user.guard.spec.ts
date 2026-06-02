import { UnauthorizedException } from '@nestjs/common';
import { BearerUserGuard } from './bearer-user.guard';

const context = (authorization?: string) => ({
  switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
}) as any;

describe('BearerUserGuard', () => {
  it('rejects missing bearer token', async () => {
    const guard = new BearerUserGuard({ getClient: jest.fn() } as any);
    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches resolved user', async () => {
    const request = { headers: { authorization: 'Bearer token' } };
    const guard = new BearerUserGuard({
      getClient: () => ({
        auth: {
          getUser: jest.fn().mockResolvedValue({
            data: { user: { id: 'u1' } },
            error: null,
          }),
        },
      }),
    } as any);
    await expect(
      guard.canActivate({
        switchToHttp: () => ({ getRequest: () => request }),
      } as any),
    ).resolves.toBe(true);
    expect((request as any).user).toEqual({ id: 'u1' });
  });

  it('rejects invalid bearer token', async () => {
    const guard = new BearerUserGuard({
      getClient: () => ({
        auth: {
          getUser: jest.fn().mockResolvedValue({
            data: { user: null },
            error: { message: 'invalid' },
          }),
        },
      }),
    } as any);
    await expect(
      guard.canActivate(
        context('Bearer bad'),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
