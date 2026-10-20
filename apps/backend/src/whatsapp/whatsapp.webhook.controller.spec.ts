import * as crypto from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { WhatsAppWebhookController } from './whatsapp.webhook.controller';

const SECRET = 'meta-app-secret';
const body = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [] }));
const sign = (b: Buffer, s: string) => 'sha256=' + crypto.createHmac('sha256', s).update(b).digest('hex');

type Guarded = { assertValidSignature(raw: Buffer | undefined, sig: string | undefined): void };

function build() {
  const warn = jest.fn();
  const controller = Object.create(WhatsAppWebhookController.prototype) as Guarded & Record<string, unknown>;
  Object.assign(controller, { logger: { warn }, warnedUnconfiguredSecret: false });
  return { controller, warn };
}

describe('WhatsAppWebhookController signature guard', () => {
  const saved = { secret: process.env['WHATSAPP_APP_SECRET'], env: process.env['NODE_ENV'] };
  afterEach(() => {
    if (saved.secret === undefined) delete process.env['WHATSAPP_APP_SECRET']; else process.env['WHATSAPP_APP_SECRET'] = saved.secret;
    if (saved.env === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = saved.env;
  });

  it('in production with no secret configured it accepts the message and warns once, so a deploy cannot stop inbound messages', () => {
    delete process.env['WHATSAPP_APP_SECRET'];
    process.env['NODE_ENV'] = 'production';
    const { controller, warn } = build();
    expect(() => controller.assertValidSignature(body, undefined)).not.toThrow();
    expect(() => controller.assertValidSignature(body, 'sha256=forged')).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('WHATSAPP_APP_SECRET is not configured');
  });

  it('once a secret is configured a wrong or missing signature is rejected, in production too', () => {
    process.env['WHATSAPP_APP_SECRET'] = SECRET;
    process.env['NODE_ENV'] = 'production';
    const { controller, warn } = build();
    expect(() => controller.assertValidSignature(body, sign(body, 'someone-elses-secret'))).toThrow(BadRequestException);
    expect(() => controller.assertValidSignature(body, undefined)).toThrow(BadRequestException);
    expect(warn).not.toHaveBeenCalled();
  });

  it('accepts a correctly signed message when the secret is configured', () => {
    process.env['WHATSAPP_APP_SECRET'] = SECRET;
    const { controller } = build();
    expect(() => controller.assertValidSignature(body, sign(body, SECRET))).not.toThrow();
  });
});
