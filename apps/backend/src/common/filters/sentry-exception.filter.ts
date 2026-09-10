import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { notify } from '../notifier';
import { ErrorLogService } from '../monitoring/error-log.service';

let Sentry: { withScope?: (cb: (s: unknown) => void) => void; captureException?: (e: unknown) => void } | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Sentry = require('@sentry/nestjs');
} catch { /* package not installed */ }

@Injectable()
@Catch()
export class SentryExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(private readonly errorLogService: ErrorLogService) {}

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

    // Forward 5xx errors to Telegram/Slack and persist them for the admin Errors page
    if (status >= 500) {
      const message = exception instanceof Error ? exception.message : String(exception);
      const stack = exception instanceof Error ? exception.stack : undefined;
      const tenantId = (request as Request & { tenantId?: string }).tenantId;
      void notify({
        source: 'backend',
        method: request.method,
        url: request.url,
        status,
        tenantId,
        message,
        stack,
      });
      void this.errorLogService.record({
        service: 'backend',
        severity: status >= 500 ? 'ERROR' : 'WARN',
        message: `${request.method} ${request.url} → ${status}: ${message}`,
        stack,
        tenantId,
        resourceType: 'http_route',
        resourceId: `${request.method} ${request.route?.path ?? request.url}`,
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
