import { BadRequestException } from '@nestjs/common';
import { InboundController } from './inbound.controller';

function build(secret: string | undefined) {
  const inboundService = { handleInboundEmail: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn((key: string) => (key === 'RESEND_WEBHOOK_SECRET' ? secret : key === 'NODE_ENV' ? 'production' : undefined)) };
  const controller = new InboundController(inboundService as never, config as never);
  const warn = jest.fn();
  Object.assign(controller, { logger: { warn } });
  return { controller, inboundService, warn };
}

const req = { rawBody: Buffer.from('{}') } as never;

describe('InboundController email webhook signature guard', () => {
  it('in production with no secret configured it still delivers the email and warns once', async () => {
    const { controller, inboundService, warn } = build(undefined);
    await expect(controller.receiveEmail(req, { subject: 'hi' }, '', '', '')).resolves.toEqual({ ok: true });
    await controller.receiveEmail(req, { subject: 'again' }, '', '', '');
    expect(inboundService.handleInboundEmail).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('RESEND_WEBHOOK_SECRET is not configured');
  });

  it('once a secret is configured, a request without signature headers is rejected and nothing is delivered', async () => {
    const { controller, inboundService } = build('whsec_dGVzdA==');
    await expect(controller.receiveEmail(req, { subject: 'hi' }, '', '', '')).rejects.toThrow(BadRequestException);
    expect(inboundService.handleInboundEmail).not.toHaveBeenCalled();
  });
});
