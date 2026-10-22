import { TenantService } from './tenant.service';

function build(subscription?: { subscribed: boolean; reason?: string }) {
  const tenantRow = { id: 't1', name: 'Acme', phoneNumberId: 'p1', wabaId: 'w1', accessToken: 'tok' };
  const prisma = {
    tenant: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(tenantRow),
      update: jest.fn().mockResolvedValue(tenantRow),
    },
  };
  const whatsAppNumbers = { upsertByPhoneNumberId: jest.fn().mockResolvedValue({ id: 'n1', webhookSubscription: subscription }) };
  const service = Object.create(TenantService.prototype) as TenantService & Record<string, unknown>;
  Object.assign(service, { prisma, whatsAppNumbers });
  return { service, whatsAppNumbers };
}

describe('TenantService.update (WhatsApp API Configuration quick-save)', () => {
  it('saves and passes Meta\'s webhook subscription failure back so the screen can explain it', async () => {
    const { service } = build({ subscribed: false, reason: '(#200) Missing permissions' });
    const result = await service.update('t1', { phoneNumberId: 'p1', wabaId: 'w1', accessToken: 'tok' });
    expect(result).toMatchObject({ id: 't1', webhookSubscription: { subscribed: false, reason: '(#200) Missing permissions' } });
  });

  it('returns the plain tenant when no WhatsApp field was sent', async () => {
    const { service, whatsAppNumbers } = build();
    const result = await service.update('t1', { name: 'Acme' });
    expect(whatsAppNumbers.upsertByPhoneNumberId).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('webhookSubscription');
  });
});
