import { Injectable, OnModuleInit } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SupabaseService implements OnModuleInit {
  private anonClient: SupabaseClient;
  private serviceClient: SupabaseClient;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const anonKey = this.configService.get<string>('SUPABASE_ANON_KEY');
    const serviceRoleKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL is required');
    }

    this.anonClient = createClient(supabaseUrl, anonKey ?? '', {
      auth: { persistSession: false },
    });

    this.serviceClient = createClient(supabaseUrl, serviceRoleKey ?? '', {
      auth: { persistSession: false },
    });
  }

  getClient(): SupabaseClient {
    return this.anonClient;
  }

  getServiceRoleClient(): SupabaseClient {
    return this.serviceClient;
  }
}
