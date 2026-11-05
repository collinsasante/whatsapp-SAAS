import { BadRequestException } from '@nestjs/common';
import { WhatsAppWebhookController } from './whatsapp.webhook.controller';
import { WebhookSignatureVerdict } from './webhook-signature/whatsapp-webhook-signature.service';

/**
 * The controller's part of signature handling: it must ask the signature service BEFORE doing anything with the body, pass it the raw bytes,
 * the header and the entries, and refuse exactly when the service says so. The policy itself (apps, mappings, modes) is tested in
 * webhook-signature/signature-policy.util.spec.ts and, against the real route and database, in test/whatsapp-webhook-signature.e2e-spec.ts.
 */
function build(verdict: Partial<WebhookSignatureVerdict>) {
  const verify = jest.fn().mockResolvedValue({ mode: 'enforce', accept: true, degraded: false, evaluation: { outcome: 'valid', appId: '1', wabaIds: [] }, ...verdict });
  const prisma = { whatsAppNumber: { findMany: jest.fn().mockResolvedValue([]) }, tenant: { findUnique: jest.fn().mockResolvedValue(null) } };
  const webhookEvents = { record: jest.fn(), markProcessed: jest.fn(), markFailed: jest.fn() };
  const controller = new WhatsAppWebhookController(prisma as never, {} as never, {} as never, webhookEvents as never, { verify } as never);
  return { controller, verify, prisma, webhookEvents };
}

const raw = Buffer.from('{"object":"whatsapp_business_account","entry":[{"id":"123456","changes":[]}]}');
const req = { rawBody: raw } as never;

describe('WhatsAppWebhookController signature handling', () => {
  it('passes the raw body, the header and the entries to the signature service', async () => {
    const { controller, verify } = build({});
    const entries = [{ id: '123456', changes: [] }];
    await controller.receive('tenant-1', req, { object: 'whatsapp_business_account', entry: entries }, 'sha256=abc');
    expect(verify).toHaveBeenCalledWith(raw, 'sha256=abc', entries);
  });

  it('refuses the request, touching nothing else, when the service does not accept it', async () => {
    const { controller, prisma, webhookEvents } = build({ accept: false, evaluation: { outcome: 'invalid', appId: null, wabaIds: ['123456'] } });
    await expect(controller.receive('tenant-1', req, { object: 'whatsapp_business_account', entry: [] }, 'sha256=bad')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.whatsAppNumber.findMany).not.toHaveBeenCalled();
    expect(webhookEvents.record).not.toHaveBeenCalled();
  });

  it('carries on when the service accepts, including in observe mode where a bad signature is only counted', async () => {
    const { controller, verify } = build({ mode: 'observe', accept: true, evaluation: { outcome: 'invalid', appId: null, wabaIds: [] } });
    await expect(controller.receive('tenant-1', req, { object: 'something_else', entry: [] }, undefined as never)).resolves.toEqual({ status: 'ok' });
    expect(verify).toHaveBeenCalledTimes(1);
  });
});
