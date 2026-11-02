import { createHmac } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { InboundController } from './inbound.controller';

function build(secret: string | undefined, nodeEnv = 'production') {
  const inboundService = { handleInboundEmail: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn((key: string) => (key === 'RESEND_WEBHOOK_SECRET' ? secret : key === 'NODE_ENV' ? nodeEnv : undefined)) };
  const controller = new InboundController(inboundService as never, config as never);
  const warn = jest.fn();
  Object.assign(controller, { logger: { warn, error: warn } });
  return { controller, inboundService, warn };
}

const req = { rawBody: Buffer.from('{}') } as never;

describe('InboundController email webhook signature guard', () => {
  it('in production with no secret configured it refuses the email and delivers nothing', async () => {
    const { controller, inboundService, warn } = build(undefined);
    await expect(controller.receiveEmail(req, { subject: 'hi' }, '', '', '')).rejects.toThrow(BadRequestException);
    await expect(controller.receiveEmail(req, { subject: 'again' }, 'id', 'ts', 'v1,x')).rejects.toThrow(BadRequestException);
    expect(inboundService.handleInboundEmail).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('RESEND_WEBHOOK_SECRET is not configured');
  });

  it('outside production with no secret configured it delivers the email and warns once', async () => {
    const { controller, inboundService, warn } = build(undefined, 'development');
    await expect(controller.receiveEmail(req, { subject: 'hi' }, '', '', '')).resolves.toEqual({ ok: true });
    await controller.receiveEmail(req, { subject: 'again' }, '', '', '');
    expect(inboundService.handleInboundEmail).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  describe('with a secret configured', () => {
    const SECRET = 'whsec_' + Buffer.from('test-secret').toString('base64');
    const sign = (id: string, ts: string, raw: Buffer, secret = SECRET) =>
      'v1,' + createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`${id}.${ts}.${raw.toString()}`).digest('base64');
    const now = () => String(Math.floor(Date.now() / 1000));

    it('delivers a correctly signed, fresh request', async () => {
      const { controller, inboundService } = build(SECRET);
      const ts = now();
      await expect(controller.receiveEmail(req, { subject: 'hi' }, 'msg_1', ts, sign('msg_1', ts, Buffer.from('{}')))).resolves.toEqual({ ok: true });
      expect(inboundService.handleInboundEmail).toHaveBeenCalledTimes(1);
    });

    it('rejects a wrong signature', async () => {
      const { controller, inboundService } = build(SECRET);
      const ts = now();
      await expect(controller.receiveEmail(req, {}, 'msg_1', ts, sign('msg_1', ts, Buffer.from('{}'), 'whsec_b3RoZXI='))).rejects.toThrow(BadRequestException);
      expect(inboundService.handleInboundEmail).not.toHaveBeenCalled();
    });

    it('rejects a replayed request whose timestamp is outside the window, even with a valid signature', async () => {
      const { controller, inboundService } = build(SECRET);
      const old = String(Math.floor(Date.now() / 1000) - 3600);
      await expect(controller.receiveEmail(req, {}, 'msg_1', old, sign('msg_1', old, Buffer.from('{}')))).rejects.toThrow(/timestamp/);
      await expect(controller.receiveEmail(req, {}, 'msg_1', 'abc', sign('msg_1', 'abc', Buffer.from('{}')))).rejects.toThrow(/timestamp/);
      expect(inboundService.handleInboundEmail).not.toHaveBeenCalled();
    });
  });

  it('once a secret is configured, a request without signature headers is rejected and nothing is delivered', async () => {
    const { controller, inboundService } = build('whsec_dGVzdA==');
    await expect(controller.receiveEmail(req, { subject: 'hi' }, '', '', '')).rejects.toThrow(BadRequestException);
    expect(inboundService.handleInboundEmail).not.toHaveBeenCalled();
  });
});
