import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import {
  getMonthlyExportLimit,
  MAX_FREE_EXPORTS_PER_MONTH,
  MonthlyExportLimit,
} from '@handclip/shared/constants/limits';

export interface QuotaInfo {
  exportsThisMonth: number;
  maxExports: MonthlyExportLimit;
  plan: string;
  isUnlimited: boolean;
}

@Injectable()
export class AuthService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async login(email: string) {
    const client = this.supabaseService.getClient();
    const { data, error } = await client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: process.env.APP_URL || 'http://localhost:3000/auth/callback',
      },
    });

    if (error) {
      throw new Error(error.message);
    }

    return { success: true, message: 'Magic link sent' };
  }

  async verify(token: string, email: string) {
    const client = this.supabaseService.getClient();
    const { data, error } = await client.auth.verifyOtp({
      email,
      token,
      type: 'email',
    });

    if (error) {
      throw new Error(error.message);
    }

    return { user: data.user, session: data.session };
  }

  async getUser(token: string) {
    const client = this.supabaseService.getClient();
    const { data, error } = await client.auth.getUser(token);

    if (error) {
      throw new Error(error.message);
    }

    return { user: data.user };
  }

  async getQuota(userId: string): Promise<QuotaInfo> {
    const supabase = this.supabaseService.getServiceRoleClient();
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('exports_this_month, plan, is_admin, last_export_reset_at')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      return {
        exportsThisMonth: 0,
        maxExports: MAX_FREE_EXPORTS_PER_MONTH,
        plan: 'free',
        isUnlimited: false,
      };
    }

    const now = new Date();
    const lastReset = profile.last_export_reset_at ? new Date(profile.last_export_reset_at) : null;
    const needsReset = !lastReset || lastReset.getMonth() !== now.getMonth() || lastReset.getFullYear() !== now.getFullYear();
    const exportsThisMonth = needsReset ? 0 : (profile.exports_this_month || 0);
    const limit = getMonthlyExportLimit(profile.plan, Boolean(profile.is_admin));

    return {
      exportsThisMonth,
      maxExports: limit,
      plan: profile.is_admin ? 'admin' : profile.plan || 'free',
      isUnlimited: limit === null,
    };
  }
}
