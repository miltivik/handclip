import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { BearerUserGuard } from './bearer-user.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthService, BearerUserGuard],
  exports: [AuthService, BearerUserGuard],
})
export class AuthModule {}
