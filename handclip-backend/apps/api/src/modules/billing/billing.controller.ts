import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { BearerUserGuard } from '../auth/bearer-user.guard';
import { CurrentUser, ResolvedUser } from '../auth/current-user.decorator';
import { BillingService } from './billing.service';

const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

class PolarWebhookVerificationError extends Error {}

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly config: ConfigService,
  ) {}

  @UseGuards(BearerUserGuard)
  @Post('checkout')
  async checkout(
    @CurrentUser() user: ResolvedUser,
    @Headers('x-forwarded-for') forwardedFor?: string,
  ) {
    const customerIp = forwardedFor?.split(',')[0]?.trim();
    return this.billing.createCheckout(user, customerIp);
  }

  @Post('webhook')
  async webhook(@Req() request: RawBodyRequest<Request>, @Body() body: unknown) {
    const secret = this.config.get<string>('POLAR_WEBHOOK_SECRET');
    if (!secret) {
      throw new ForbiddenException('POLAR_WEBHOOK_SECRET is required');
    }

    try {
      const event = validatePolarWebhookEvent(
        request.rawBody || Buffer.from(JSON.stringify(body)),
        request.headers,
        secret,
      );
      await this.billing.handleWebhookEvent(event as Parameters<BillingService['handleWebhookEvent']>[0]);
      return { received: true };
    } catch (error) {
      if (error instanceof PolarWebhookVerificationError) {
        throw new ForbiddenException('Invalid Polar webhook signature');
      }
      throw error;
    }
  }
}

function validatePolarWebhookEvent(
  rawBody: Buffer,
  headers: Request['headers'],
  secret: string,
): unknown {
  const webhookId = headerValue(headers, 'webhook-id');
  const timestamp = headerValue(headers, 'webhook-timestamp');
  const signatureHeader = headerValue(headers, 'webhook-signature');
  if (!webhookId || !timestamp || !signatureHeader) {
    throw new PolarWebhookVerificationError('Missing required Polar webhook headers');
  }

  const timestampSeconds = Number.parseInt(timestamp, 10);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    Number.isNaN(timestampSeconds) ||
    nowSeconds - timestampSeconds > WEBHOOK_TOLERANCE_SECONDS ||
    timestampSeconds - nowSeconds > WEBHOOK_TOLERANCE_SECONDS
  ) {
    throw new PolarWebhookVerificationError('Invalid Polar webhook timestamp');
  }

  const secretValue = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  const signedPayload = `${webhookId}.${timestamp}.${rawBody.toString()}`;
  const expected = createHmac('sha256', Buffer.from(secretValue, 'base64'))
    .update(signedPayload)
    .digest('base64');

  const valid = signatureHeader.split(' ').some((candidate) => {
    const [version, signature] = candidate.split(',');
    if (version !== 'v1' || !signature) return false;
    const expectedBytes = Buffer.from(expected);
    const actualBytes = Buffer.from(signature);
    return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
  });

  if (!valid) {
    throw new PolarWebhookVerificationError('No matching Polar webhook signature');
  }

  return JSON.parse(rawBody.toString());
}

function headerValue(headers: Request['headers'], name: string): string | undefined {
  const value = headers[name];
  if (Array.isArray(value)) return value[0];
  return typeof value === 'string' ? value : undefined;
}
