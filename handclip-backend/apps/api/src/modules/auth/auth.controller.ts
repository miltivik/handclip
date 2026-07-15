import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { Public } from '../../decorators/public.decorator';
import { CurrentUser } from '../../decorators/current-user.decorator';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { PerEmailThrottlerGuard } from '../../guards/per-email-throttler.guard';
import { LoginDtoSchema, VerifyDtoSchema, LoginDto, VerifyDto } from '@handclip/shared';
import { AuthService } from './auth.service';

type AuthUser = {
  id: string;
  role?: 'internal';
  email?: string;
  [k: string]: unknown;
};

@Controller('auth')
@UseGuards(PerEmailThrottlerGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { ttl: seconds(60), limit: 5 } })
  @Public()
  @Post('login')
  async login(@Body(new ZodValidationPipe(LoginDtoSchema)) body: LoginDto) {
    return this.authService.login(body.email);
  }

  @Throttle({ default: { ttl: seconds(60), limit: 5 } })
  @Public()
  @Post('verify')
  async verify(@Body(new ZodValidationPipe(VerifyDtoSchema)) body: VerifyDto) {
    return this.authService.verify(body.token, body.email);
  }
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return { user };
  }
}
