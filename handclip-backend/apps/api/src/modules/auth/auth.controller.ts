import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../decorators/public.decorator';
import { AuthService } from './auth.service';
import { BearerUserGuard } from './bearer-user.guard';
import { CurrentUser, ResolvedUser } from './current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Public()
  @Post('login')
  async login(@Body() body: { email: string }) {
    return this.authService.login(body.email);
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Public()
  @Post('verify')
  async verify(@Body() body: { token: string; email: string }) {
    return this.authService.verify(body.token, body.email);
  }

  @Get('me')
  async me(@Body() body: { token: string }) {
    return this.authService.getUser(body.token);
  }

  @UseGuards(BearerUserGuard)
  @Get('quota')
  async getQuota(@CurrentUser() user: ResolvedUser) {
    return this.authService.getQuota(user.id);
  }
}
