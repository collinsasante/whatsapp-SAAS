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

describe('SentryExceptionFilter: provider errors are not the caller\'s status', () => {
  const build = () => {
    const errorLogService = { record: jest.fn().mockResolvedValue(undefined) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { filter: new SentryExceptionFilter(errorLogService as any), errorLogService };
  };

  // A real AxiosError, as axios throws it when Paystack/Meta/TikTok answers with an error status.
  const axiosFailure = (status: number) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AxiosError } = require('axios');
    return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', undefined, undefined, { status, data: { secretDetail: 'do-not-leak' } });
  };

  it.each([400, 401, 403, 404, 429])('a provider answering %i becomes a 502 for the user, never that status', (providerStatus) => {
    const { filter, errorLogService } = build();
    const { host, response } = buildHost({ method: 'POST', url: '/api/v1/billing/credits/checkout/paystack' });

    filter.catch(axiosFailure(providerStatus), host as never);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
    const body = response.json.mock.calls[0][0];
    expect(body.statusCode).toBe(502);
    expect(body.message).toBe('A request to an external service failed. Please try again shortly.');
    expect(JSON.stringify(body)).not.toContain('do-not-leak');
    expect(JSON.stringify(body)).not.toContain('status code');
    // It is an operator problem, so it is recorded, with the provider's status to diagnose it.
    expect(errorLogService.record).toHaveBeenCalledWith(expect.objectContaining({ severity: 'ERROR' }));
    expect(errorLogService.record.mock.calls[0][0].message).toContain(`provider answered HTTP ${providerStatus}`);
  });

  it('a Stripe SDK authentication error is a 502 too, not a 401', () => {
    const { filter } = build();
    const { host, response } = buildHost();
    const stripe = Object.assign(new Error('Invalid API Key provided: sk_test_***'), { type: 'StripeAuthenticationError', statusCode: 401 });

    filter.catch(stripe, host as never);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
    expect(JSON.stringify(response.json.mock.calls[0][0])).not.toContain('sk_test');
  });

  it('still respects the status of errors from the HTTP stack itself (body-parser, http-errors)', () => {
    const { filter } = build();
    const { host, response } = buildHost();
    const tooLarge = Object.assign(new Error('request entity too large'), { status: 413, statusCode: 413, expose: true, type: 'entity.too.large' });

    filter.catch(tooLarge, host as never);

    expect(response.status).toHaveBeenCalledWith(413);
  });

  it('an arbitrary error that merely has a numeric status field is a 500, not that status', () => {
    const { filter } = build();
    const { host, response } = buildHost();

    filter.catch(Object.assign(new Error('boom'), { status: 401 }), host as never);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
  });
});
