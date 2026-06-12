import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

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
      console.error('Auth login failed:', error);
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
      console.error('Auth verify failed:', error);
      throw new Error(error.message);
    }

    return { user: data.user, session: data.session };
  }

  async getUser(token: string) {
    const client = this.supabaseService.getClient();
    const { data, error } = await client.auth.getUser(token);

    if (error) {
      console.error('Auth getUser failed:', error);
      throw new Error(error.message);
    }

    return { user: data.user };
  }
}
