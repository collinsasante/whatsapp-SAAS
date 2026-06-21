import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { notify } from '../notifier';

let Sentry: { withScope?: (cb: (s: unknown) => void) => void; captureException?: (e: unknown) => void } | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Sentry = require('@sentry/nestjs');
} catch { /* package not installed */ }

@Catch()
export class SentryExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Non-HttpException errors raised by middleware (e.g. body-parser's
    // PayloadTooLargeError) still carry a valid HTTP status — respect it
    // instead of always reporting a generic 500.
    const rawStatus = (exception as { status?: unknown; statusCode?: unknown })?.status
      ?? (exception as { status?: unknown; statusCode?: unknown })?.statusCode;
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : typeof rawStatus === 'number' && rawStatus >= 400 && rawStatus < 600
          ? rawStatus
          : HttpStatus.INTERNAL_SERVER_ERROR;

    // Log 5xx errors
    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    // Only capture 5xx errors in Sentry
    if (status >= 500 && Sentry?.withScope) {
      Sentry.withScope((scope: { setTag: (k: string, v: string) => void; setExtra: (k: string, v: unknown) => void }) => {
        scope.setTag('url', request.url);
        scope.setTag('method', request.method);
        scope.setExtra('tenantId', (request as Request & { tenantId?: string }).tenantId);
        Sentry?.captureException?.(exception);
      });
    }

    // Forward 5xx errors to Telegram and Slack
    if (status >= 500) {
      const message = exception instanceof Error ? exception.message : String(exception);
      const stack = exception instanceof Error ? exception.stack : undefined;
      void notify({
        source: 'backend',
        method: request.method,
        url: request.url,
        status,
        tenantId: (request as Request & { tenantId?: string }).tenantId,
        message,
        stack,
      });
    }

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : status < 500 && exception instanceof Error
          ? { statusCode: status, message: exception.message }
          : { statusCode: status, message: 'Internal server error' };

    response.status(status).json(message);
  }
}
