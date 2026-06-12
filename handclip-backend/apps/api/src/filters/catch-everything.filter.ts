import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

@Catch()
export class CatchEverythingFilter implements ExceptionFilter {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();

    const httpStatus =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof Error ? exception.message : 'Internal server error';

    // Log full error in production (structured, not raw stack)
    if (httpStatus >= 500) {
      console.error(
        `[Unhandled ${httpStatus}] ${ctx.getRequest()?.method} ${ctx.getRequest()?.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const responseBody: Record<string, unknown> = {
      statusCode: httpStatus,
      timestamp: new Date().toISOString(),
      path: httpAdapter.getRequestUrl(ctx.getRequest()),
    };

    // Only include message for non-500 errors (avoid leaking internals)
    if (httpStatus < 500) {
      responseBody.message = message;
    }

    httpAdapter.reply(ctx.getResponse(), responseBody, httpStatus);
  }
}
