import { Test } from '@nestjs/testing';
import { SupabaseService } from '../supabase/supabase.service';
import { AuthService } from './auth.service';

interface MockChain {
  select: jest.Mock;
  eq: jest.Mock;
  single: jest.Mock;
}

function buildSupabaseMock() {
  const queue: MockChain[] = [];
  let queueIndex = 0;

  const make = (): MockChain => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(),
  });

  const from = jest.fn((): MockChain => {
    if (queueIndex < queue.length) {
      return queue[queueIndex++];
    }
    return make();
  });

  return {
    getServiceRoleClient: () => ({ from }),
    queueChain: (chain: MockChain) => {
      queue.push(chain);
    },
    resetQueue: () => {
      queue.length = 0;
      queueIndex = 0;
    },
  };
}

describe('AuthService.getQuota', () => {
  let service: AuthService;
  let supabase: ReturnType<typeof buildSupabaseMock>;

  beforeEach(async () => {
    supabase = buildSupabaseMock();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: SupabaseService, useValue: supabase },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('returns correct count when profile exists and is current month', async () => {
    const now = new Date();
    const chain: MockChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          exports_this_month: 2,
          plan: 'free',
          last_export_reset_at: now.toISOString(),
        },
        error: null,
      }),
    };
    supabase.queueChain(chain);

    await expect(service.getQuota('user-123')).resolves.toMatchObject({
      exportsThisMonth: 2,
      maxExports: 3,
      plan: 'free',
    });
  });

  it('returns 0 count when last reset is from different month', async () => {
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);

    const chain: MockChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          exports_this_month: 5,
          plan: 'free',
          last_export_reset_at: lastMonth.toISOString(),
        },
        error: null,
      }),
    };
    supabase.queueChain(chain);

    await expect(service.getQuota('user-123')).resolves.toMatchObject({
      exportsThisMonth: 0,
      maxExports: 3,
      plan: 'free',
    });
  });

  it('handles missing profile gracefully', async () => {
    const chain: MockChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      }),
    };
    supabase.queueChain(chain);

    await expect(service.getQuota('user-123')).resolves.toMatchObject({
      exportsThisMonth: 0,
      maxExports: 3,
      plan: 'free',
    });
  });

  it('returns pro plan when profile has pro', async () => {
    const chain: MockChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          exports_this_month: 1,
          plan: 'pro',
          is_admin: false,
          last_export_reset_at: new Date().toISOString(),
        },
        error: null,
      }),
    };
    supabase.queueChain(chain);

    await expect(service.getQuota('user-123')).resolves.toMatchObject({
      plan: 'pro',
      maxExports: null,
      isUnlimited: true,
    });
  });

  it('returns unlimited quota for admins', async () => {
    const chain: MockChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          exports_this_month: 9,
          plan: 'free',
          is_admin: true,
          last_export_reset_at: new Date().toISOString(),
        },
        error: null,
      }),
    };
    supabase.queueChain(chain);

    await expect(service.getQuota('admin-user')).resolves.toMatchObject({
      exportsThisMonth: 9,
      maxExports: null,
      plan: 'admin',
      isUnlimited: true,
    });
  });
});
