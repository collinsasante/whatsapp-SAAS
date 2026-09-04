import { HttpException, HttpStatus } from '@nestjs/common';
import { SentryExceptionFilter } from './sentry-exception.filter';

function buildHost(overrides: Partial<{ method: string; url: string; tenantId: string; route: { path: string } }> = {}) {
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const request = { method: overrides.method ?? 'GET', url: overrides.url ?? '/api/v1/x', tenantId: overrides.tenantId, route: overrides.route };
  return {
    host: { switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }) },
    response,
    request,
  };
}

describe('SentryExceptionFilter', () => {
  it('records a 5xx exception to ErrorLogService', () => {
    const errorLogService = { record: jest.fn().mockResolvedValue(undefined) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter = new SentryExceptionFilter(errorLogService as any);
    const { host, response } = buildHost({ method: 'POST', url: '/api/v1/orders', tenantId: 't1' });

    filter.catch(new Error('db exploded'), host as never);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(errorLogService.record).toHaveBeenCalledWith(expect.objectContaining({
      service: 'backend',
      tenantId: 't1',
      resourceType: 'http_route',
    }));
    expect(errorLogService.record.mock.calls[0][0].message).toContain('db exploded');
  });

  it('does not record a plain 4xx HttpException', () => {
    const errorLogService = { record: jest.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter = new SentryExceptionFilter(errorLogService as any);
    const { host, response } = buildHost();

    filter.catch(new HttpException('not found', HttpStatus.NOT_FOUND), host as never);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(errorLogService.record).not.toHaveBeenCalled();
  });

  it('records a 503 HttpException (5xx, not just unhandled errors)', () => {
    const errorLogService = { record: jest.fn().mockResolvedValue(undefined) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter = new SentryExceptionFilter(errorLogService as any);
    const { host } = buildHost();

    filter.catch(new HttpException('unavailable', HttpStatus.SERVICE_UNAVAILABLE), host as never);

    expect(errorLogService.record).toHaveBeenCalled();
  });
});
