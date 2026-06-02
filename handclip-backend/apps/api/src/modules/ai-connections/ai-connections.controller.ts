import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AiSubscriptionProvider } from '@handclip/shared';
import { BearerUserGuard } from '../auth/bearer-user.guard';
import { CurrentUser, ResolvedUser } from '../auth/current-user.decorator';
import { AiConnectionsService } from './ai-connections.service';
import { OAuthAttemptManager } from './oauth-attempts.service';

const ALLOWED_PROVIDERS: readonly AiSubscriptionProvider[] = [
  'openai-codex',
  'anthropic',
];

@Controller('ai-connections')
@UseGuards(BearerUserGuard)
export class AiConnectionsController {
  constructor(
    private readonly connections: AiConnectionsService,
    private readonly attempts: OAuthAttemptManager,
  ) {}

  @Get()
  async list(@CurrentUser() user: ResolvedUser) {
    return this.connections.list(user.id);
  }

  @Post(':provider/start')
  async start(
    @CurrentUser() user: ResolvedUser,
    @Param('provider') provider: string,
  ) {
    return this.attempts.start(user.id, this.parseProvider(provider));
  }

  @Get(':provider/attempts/:attemptId')
  async status(
    @CurrentUser() user: ResolvedUser,
    @Param('provider') provider: string,
    @Param('attemptId') attemptId: string,
  ) {
    this.parseProvider(provider);
    return this.attempts.get(user.id, attemptId);
  }

  @Post(':provider/attempts/:attemptId/input')
  async input(
    @CurrentUser() user: ResolvedUser,
    @Param('provider') provider: string,
    @Param('attemptId') attemptId: string,
    @Body() body: { input?: string },
  ) {
    this.parseProvider(provider);
    if (typeof body?.input !== 'string' || body.input.trim().length === 0) {
      throw new BadRequestException('input must be a non-empty string');
    }
    return this.attempts.submitInput(user.id, attemptId, body.input);
  }

  @Patch('active')
  async active(
    @CurrentUser() user: ResolvedUser,
    @Body() body: { provider?: AiSubscriptionProvider },
  ) {
    if (!body?.provider || !ALLOWED_PROVIDERS.includes(body.provider)) {
      throw new BadRequestException('provider is required');
    }
    await this.connections.setActive(user.id, body.provider);
    return { active: body.provider };
  }

  @Delete(':provider')
  async disconnect(
    @CurrentUser() user: ResolvedUser,
    @Param('provider') provider: string,
  ) {
    await this.connections.disconnect(user.id, this.parseProvider(provider));
    return { disconnected: provider };
  }

  private parseProvider(value: string): AiSubscriptionProvider {
    if (!ALLOWED_PROVIDERS.includes(value as AiSubscriptionProvider)) {
      throw new BadRequestException(
        `Unsupported provider: ${value}. Allowed: ${ALLOWED_PROVIDERS.join(', ')}`,
      );
    }
    return value as AiSubscriptionProvider;
  }
}
