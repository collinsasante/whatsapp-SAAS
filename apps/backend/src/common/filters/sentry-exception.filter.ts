import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Request, Response } from 'express';

@Catch()
export class SentryExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // Only capture 5xx errors — 4xx are user errors, not bugs
    if (status >= 500) {
      Sentry.withScope((scope) => {
        scope.setTag('url', request.url);
        scope.setTag('method', request.method);
        scope.setExtra('tenantId', (request as Request & { tenantId?: string }).tenantId);
        Sentry.captureException(exception);
      });
    }

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : { statusCode: status, message: 'Internal server error' };

    response.status(status).json(message);
  }
}
