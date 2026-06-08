import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { AuthModule } from '../auth/auth.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  imports: [SupabaseModule, AuthModule],
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}
