import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';

interface PolarCheckoutResponse {
  id: string;
  url: string;
}

interface PolarWebhookEvent {
  type?: string;
  data?: Record<string, any>;
}

@Injectable()
export class BillingService {
  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
  ) {}

  async createCheckout(user: { id: string; email?: string }, customerIp?: string) {
    const accessToken = this.required('POLAR_ACCESS_TOKEN');
    const productId = this.required('POLAR_PRODUCT_ID');
    const apiUrl = this.config.get<string>('POLAR_API_URL') || 'https://api.polar.sh/v1';
    const successUrl = this.config.get<string>('POLAR_SUCCESS_URL') || 'handclip://settings';
    const returnUrl = this.config.get<string>('POLAR_RETURN_URL') || 'handclip://settings';

    const body: Record<string, unknown> = {
      products: [productId],
      external_customer_id: user.id,
      metadata: { user_id: user.id },
      customer_metadata: { supabase_user_id: user.id },
      success_url: successUrl,
      return_url: returnUrl,
    };
    if (user.email) body.customer_email = user.email;
    if (customerIp) body.customer_ip_address = customerIp;

    const response = await fetch(`${apiUrl.replace(/\/$/, '')}/checkouts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new BadRequestException(`Polar checkout failed: ${text || response.statusText}`);
    }

    const checkout = await response.json() as PolarCheckoutResponse;
    if (!checkout.url) {
      throw new BadRequestException('Polar checkout response missing url');
    }

    return { id: checkout.id, url: checkout.url };
  }

  async handleWebhookEvent(event: PolarWebhookEvent) {
    const type = event.type || '';
    const data = event.data || {};

    if (!type.startsWith('subscription.')) {
      return { ignored: true };
    }

    const userId = this.getUserId(data);
    if (!userId) {
      throw new BadRequestException('Polar webhook missing customer external id');
    }

    const subscriptionId = this.asString(data.id);
    const productId = this.asString(data.product_id) || this.asString(data.product?.id);
    const status = this.asString(data.status) || type.replace('subscription.', '');
    const currentPeriodEnd = this.asString(data.current_period_end);
    const revoked = type === 'subscription.revoked' || Boolean(data.ended_at) || status === 'revoked';
    const plan = revoked ? 'free' : 'pro';

    const update = {
      plan,
      polar_customer_id: this.asString(data.customer_id) || this.asString(data.customer?.id),
      polar_subscription_id: subscriptionId,
      polar_product_id: productId,
      subscription_status: status,
      subscription_current_period_end: currentPeriodEnd,
      updated_at: new Date().toISOString(),
    };

    const { error } = await this.supabase
      .getServiceRoleClient()
      .from('profiles')
      .update(update)
      .eq('id', userId);

    if (error) {
      throw new BadRequestException(error.message);
    }

    return { updated: true, userId, plan };
  }

  private required(name: string): string {
    const value = this.config.get<string>(name);
    if (!value) {
      throw new ServiceUnavailableException(`${name} is required`);
    }
    return value;
  }

  private getUserId(data: Record<string, any>): string | undefined {
    return (
      this.asString(data.customer?.external_id) ||
      this.asString(data.external_customer_id) ||
      this.asString(data.metadata?.user_id) ||
      this.asString(data.customer_metadata?.supabase_user_id)
    );
  }

  private asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}
