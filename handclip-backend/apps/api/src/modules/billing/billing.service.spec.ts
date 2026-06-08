import { ConfigService } from '@nestjs/config';
import { BillingService } from './billing.service';

function buildSupabaseMock() {
  const update = jest.fn().mockReturnThis();
  const eq = jest.fn().mockResolvedValue({ error: null });
  return {
    getServiceRoleClient: () => ({
      from: jest.fn(() => ({ update, eq })),
    }),
    update,
    eq,
  };
}

function buildConfig(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('BillingService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('creates Polar checkout with Supabase user as external customer id', async () => {
    const supabase = buildSupabaseMock();
    const service = new BillingService(
      buildConfig({
        POLAR_ACCESS_TOKEN: 'token',
        POLAR_PRODUCT_ID: 'product-1',
        POLAR_API_URL: 'https://sandbox-api.polar.sh/v1',
      }),
      supabase as any,
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'checkout-1', url: 'https://checkout.polar.sh/session' }),
    }) as unknown as typeof fetch;

    await expect(service.createCheckout({ id: 'user-1', email: 'u@example.com' }, '127.0.0.1')).resolves.toEqual({
      id: 'checkout-1',
      url: 'https://checkout.polar.sh/session',
    });

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({
      products: ['product-1'],
      external_customer_id: 'user-1',
      customer_email: 'u@example.com',
      metadata: { user_id: 'user-1' },
      customer_metadata: { supabase_user_id: 'user-1' },
      customer_ip_address: '127.0.0.1',
    });
  });

  it('marks profile pro when subscription webhook is active', async () => {
    const supabase = buildSupabaseMock();
    const service = new BillingService(buildConfig({}), supabase as any);

    await expect(service.handleWebhookEvent({
      type: 'subscription.active',
      data: {
        id: 'sub-1',
        status: 'active',
        current_period_end: '2026-07-01T00:00:00Z',
        product: { id: 'product-1' },
        customer: { id: 'customer-1', external_id: 'user-1' },
      },
    })).resolves.toEqual({ updated: true, userId: 'user-1', plan: 'pro' });

    expect(supabase.update).toHaveBeenCalledWith(expect.objectContaining({
      plan: 'pro',
      polar_customer_id: 'customer-1',
      polar_subscription_id: 'sub-1',
      polar_product_id: 'product-1',
      subscription_status: 'active',
      subscription_current_period_end: '2026-07-01T00:00:00Z',
    }));
    expect(supabase.eq).toHaveBeenCalledWith('id', 'user-1');
  });

  it('marks profile free when subscription is revoked', async () => {
    const supabase = buildSupabaseMock();
    const service = new BillingService(buildConfig({}), supabase as any);

    await expect(service.handleWebhookEvent({
      type: 'subscription.revoked',
      data: {
        id: 'sub-1',
        status: 'revoked',
        customer: { external_id: 'user-1' },
      },
    })).resolves.toEqual({ updated: true, userId: 'user-1', plan: 'free' });

    expect(supabase.update).toHaveBeenCalledWith(expect.objectContaining({ plan: 'free' }));
  });
});
