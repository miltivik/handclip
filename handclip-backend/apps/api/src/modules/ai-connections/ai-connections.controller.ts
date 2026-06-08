import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AiConnectionType,
  AiProviderId,
  AiSubscriptionProvider,
  PROVIDER_CATALOG,
  getProviderEntry,
  isKnownProviderId,
} from '@handclip/shared';
import { BearerUserGuard } from '../auth/bearer-user.guard';
import { CurrentUser, ResolvedUser } from '../auth/current-user.decorator';
import {
  ApiKeyConnectionBodySchema,
  OpenAiCompatibleConnectionBodySchema,
  SetActiveBodySchema,
  ValidateBodySchema,
} from './ai-connections.dto';
import {
  AiConnectionsService,
  InvalidConnectionPayloadError,
  UnsupportedProviderError,
} from './ai-connections.service';
import { OAuthAttemptManager } from './oauth-attempts.service';

const OAUTH_PROVIDERS: readonly AiSubscriptionProvider[] = [
  'openai-codex',
  'anthropic',
];

function isOAuthProvider(value: string): value is AiSubscriptionProvider {
  return (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

@Controller('ai-connections')
@UseGuards(BearerUserGuard)
export class AiConnectionsController {
  constructor(
    private readonly connections: AiConnectionsService,
    private readonly attempts: OAuthAttemptManager,
  ) {}

  @Get('providers')
  async listProviders() {
    return PROVIDER_CATALOG.map((entry) => ({
      ...entry,
      // Explicitly clear any server-only flag if present
    }));
  }

  @Get()
  async list(@CurrentUser() user: ResolvedUser) {
    return this.connections.list(user.id);
  }

  @Post(':provider/start')
  async start(
    @CurrentUser() user: ResolvedUser,
    @Param('provider') provider: string,
  ) {
    return this.attempts.start(user.id, this.parseOAuthProvider(provider));
  }

  @Get(':provider/attempts/:attemptId')
  async status(
    @CurrentUser() user: ResolvedUser,
    @Param('provider') provider: string,
    @Param('attemptId') attemptId: string,
  ) {
    this.parseOAuthProvider(provider);
    return this.attempts.get(user.id, attemptId);
  }

  @Post(':provider/attempts/:attemptId/input')
  async input(
    @CurrentUser() user: ResolvedUser,
    @Param('provider') provider: string,
    @Param('attemptId') attemptId: string,
    @Body() body: { input?: string },
  ) {
    this.parseOAuthProvider(provider);
    if (typeof body?.input !== 'string' || body.input.trim().length === 0) {
      throw new BadRequestException('input must be a non-empty string');
    }
    return this.attempts.submitInput(user.id, attemptId, body.input);
  }

  @Post(':provider/api-key')
  async connectApiKey(
    @CurrentUser() user: ResolvedUser,
    @Param('provider') provider: string,
    @Body() rawBody: unknown,
  ) {
    if (!isKnownProviderId(provider)) {
      throw new BadRequestException(`Unsupported provider: ${provider}`);
    }
    const entry = getProviderEntry(provider, 'api-key');
    if (!entry) {
      throw new BadRequestException(
        `Provider ${provider} does not support API-key connection`,
      );
    }
    const parsed = ApiKeyConnectionBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid body');
    }
    try {
      await this.connections.upsertConnection(user.id, {
        provider: entry.id as never,
        connectionType: 'api-key',
        credentials: { type: 'api-key', apiKey: parsed.data.apiKey },
        model: parsed.data.model,
      });
    } catch (e) {
      this.rethrowAsBadRequest(e);
    }
    return { ok: true };
  }
  @Post(':provider/openai-compatible')
  async connectOpenAiCompatible(
    @CurrentUser() user: ResolvedUser,
    @Param('provider') provider: string,
    @Body() rawBody: unknown,
  ) {
    if (provider !== 'custom' && provider !== 'zai-coding-plan') {
      throw new BadRequestException(
        'Only providers "custom" and "zai-coding-plan" support openai-compatible connections',
      );
    }
    const parsed = OpenAiCompatibleConnectionBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid body');
    }
    const catalogEntry = getProviderEntry(provider, 'openai-compatible');
    const rawBaseUrl = parsed.data.baseUrl || catalogEntry?.defaultBaseUrl;
    if (!rawBaseUrl) {
      throw new BadRequestException('baseUrl is required for this provider');
    }
    let effectiveBaseUrl: string;
    try {
      effectiveBaseUrl = await this.connections.sanitizeBaseUrl(rawBaseUrl);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Invalid baseUrl');
    }
    try {
      await this.connections.upsertConnection(user.id, {
        provider: provider as never,
        connectionType: 'openai-compatible',
        credentials: {
          type: 'openai-compatible',
          apiKey: parsed.data.apiKey,
          baseUrl: effectiveBaseUrl,
          model: parsed.data.model,
        },
        model: parsed.data.model,
        baseUrl: effectiveBaseUrl,
      });
    } catch (e) {
      this.rethrowAsBadRequest(e);
    }
    return { ok: true };
  }

  @Post(':provider/validate')
  async validate(
    @CurrentUser() user: ResolvedUser,
    @Param('provider') provider: string,
    @Body() rawBody: unknown,
  ) {
    if (!isKnownProviderId(provider)) {
      throw new BadRequestException(`Unsupported provider: ${provider}`);
    }
    const parsed = ValidateBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid body');
    }
    // Resolve baseUrl from catalog default if not provided (e.g. zai-coding-plan)
    const catalogEntry = getProviderEntry(provider, parsed.data.connectionType);
    const effectiveBaseUrl = parsed.data.baseUrl || catalogEntry?.defaultBaseUrl;
    try {
      return await this.connections.validateAndListModels(
        provider,
        parsed.data.connectionType,
        parsed.data.apiKey,
        effectiveBaseUrl,
      );
    } catch (e) {
      this.rethrowAsBadRequest(e);
    }
  }

  @Patch('active')
  async active(@CurrentUser() user: ResolvedUser, @Body() rawBody: unknown) {
    const parsed = SetActiveBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid body');
    }
    const { provider, connectionType } = parsed.data;
    if (connectionType === 'oauth') {
      this.parseOAuthProvider(provider);
    } else if (!isKnownProviderId(provider)) {
      throw new BadRequestException(`Unsupported provider: ${provider}`);
    } else if (connectionType === 'openai-compatible' && provider !== 'custom' && provider !== 'zai-coding-plan') {
      throw new BadRequestException(
        `Provider ${provider} does not support openai-compatible connections`,
      );
    }
    try {
      await this.connections.setActive(user.id, provider as AiProviderId, connectionType);
    } catch (e) {
      this.rethrowAsBadRequest(e);
    }
    return { active: { provider, connectionType } };
  }

  @Delete(':provider')
  async disconnect(
    @CurrentUser() user: ResolvedUser,
    @Param('provider') provider: string,
    @Query('connectionType') connectionTypeRaw?: string,
  ) {
    if (!connectionTypeRaw) {
      throw new BadRequestException('connectionType query param is required');
    }
    const valid: AiConnectionType[] = ['oauth', 'api-key', 'openai-compatible'];
    if (!valid.includes(connectionTypeRaw as AiConnectionType)) {
      throw new BadRequestException(`Invalid connectionType: ${connectionTypeRaw}`);
    }
    const connectionType = connectionTypeRaw as AiConnectionType;
    if (connectionType === 'oauth') {
      this.parseOAuthProvider(provider);
    } else if (!isKnownProviderId(provider)) {
      throw new BadRequestException(`Unsupported provider: ${provider}`);
    } else if (connectionType === 'openai-compatible' && provider !== 'custom' && provider !== 'zai-coding-plan') {
      throw new BadRequestException(
        `Provider ${provider} does not support openai-compatible connections`,
      );
    }
    try {
      await this.connections.disconnect(
        user.id,
        provider as AiProviderId,
        connectionType,
      );
    } catch (e) {
      this.rethrowAsBadRequest(e);
    }
    return { disconnected: { provider, connectionType } };
  }

  private parseOAuthProvider(value: string): AiSubscriptionProvider {
    if (!isOAuthProvider(value)) {
      throw new BadRequestException(
        `Unsupported OAuth provider: ${value}. Allowed: ${OAUTH_PROVIDERS.join(', ')}`,
      );
    }
    return value;
  }

  private rethrowAsBadRequest(e: unknown): never {
    if (e instanceof UnsupportedProviderError || e instanceof InvalidConnectionPayloadError) {
      throw new BadRequestException(e.message);
    }
    throw e;
  }
}
