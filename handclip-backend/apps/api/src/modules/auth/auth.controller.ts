import { Controller, Post, Get, Body } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() body: { email: string }) {
    return this.authService.login(body.email);
  }

  @Post('verify')
  async verify(@Body() body: { token: string; email: string }) {
    return this.authService.verify(body.token, body.email);
  }

  @Get('me')
  async me(@Body() body: { token: string }) {
    return this.authService.getUser(body.token);
  }
}
