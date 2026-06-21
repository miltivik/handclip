import { Controller, Post, Get, Body } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { Public } from '../../decorators/public.decorator';
import { CurrentUser } from '../../decorators/current-user.decorator';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { ttl: seconds(60), limit: 5 } })
  @Public()
  @Post('login')
  async login(@Body() body: { email: string }) {
    return this.authService.login(body.email);
  }

  @Throttle({ default: { ttl: seconds(60), limit: 5 } })
  @Public()
  @Post('verify')
  async verify(@Body() body: { token: string; email: string }) {
    return this.authService.verify(body.token, body.email);
  }

  @Get('me')
  async me(@CurrentUser() user: any) {
    return { user };
  }
}
