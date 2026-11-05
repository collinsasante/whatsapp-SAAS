import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { notify } from '../notifier';
import { ErrorLogService } from '../monitoring/error-log.service';

let Sentry: { withScope?: (cb: (s: unknown) => void) => void; captureException?: (e: unknown) => void } | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Sentry = require('@sentry/nestjs');
} catch { /* package not installed */ }

/** A failed call to an external provider: an axios error, or an error from the Stripe SDK. */
function isUpstreamError(exception: unknown): boolean {
  if (typeof exception !== 'object' || exception === null) return false;
  const e = exception as { isAxiosError?: unknown; type?: unknown };
  return e.isAxiosError === true || (typeof e.type === 'string' && e.type.startsWith('Stripe'));
}

function upstreamHttpStatus(exception: unknown): number | undefined {
  const e = exception as { response?: { status?: unknown }; statusCode?: unknown };
  const status = e.response?.status ?? e.statusCode;
  return typeof status === 'number' ? status : undefined;
}

@Injectable()
@Catch()
export class SentryExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(private readonly errorLogService: ErrorLogService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Non-HttpException errors raised by the HTTP stack itself (e.g. body-parser's PayloadTooLargeError, built with http-errors)
    // still carry a valid HTTP status — respect it instead of always reporting a generic 500. Only those: http-errors marks its
    // errors with a boolean `expose`.
    // A failed call to a provider (axios, Stripe) carries the PROVIDER's status, which says nothing about the caller's request.
    // Forwarding it turned our own expired or missing provider credential into a 401 for the user, which the web app reads as an
    // expired session and answers by refreshing and retrying, and a provider 404 or 429 into a misleading 404 or 429 for the user.
    // Those are a bad gateway from the user's point of view, and ours to fix.
    const upstream = isUpstreamError(exception);
    const rawStatus = (exception as { status?: unknown; statusCode?: unknown })?.status
      ?? (exception as { status?: unknown; statusCode?: unknown })?.statusCode;
    const fromHttpStack = typeof (exception as { expose?: unknown })?.expose === 'boolean';
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : upstream
          ? HttpStatus.BAD_GATEWAY
          : fromHttpStack && typeof rawStatus === 'number' && rawStatus >= 400 && rawStatus < 600
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
      const upstreamStatus = upstream ? upstreamHttpStatus(exception) : undefined;
      const message = (exception instanceof Error ? exception.message : String(exception)) + (upstreamStatus ? ` (provider answered HTTP ${upstreamStatus})` : '');
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
        : upstream
          ? { statusCode: status, message: 'A request to an external service failed. Please try again shortly.' }
          : status < 500 && exception instanceof Error
          ? { statusCode: status, message: exception.message }
          : { statusCode: status, message: 'Internal server error' };

    response.status(status).json(message);
  }
}
