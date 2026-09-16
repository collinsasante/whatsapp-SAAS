import { TenantService } from './tenant.service';

function buildPrismaMock(existingTenant: Record<string, unknown>) {
  return {
    tenant: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(existingTenant),
      update: jest.fn().mockResolvedValue(existingTenant),
    },
    contact: { count: jest.fn() },
    conversation: { count: jest.fn() },
    message: { count: jest.fn() },
    campaign: { count: jest.fn() },
  };
}

function buildDeps(existingTenant: Record<string, unknown>) {
  return {
    prisma: buildPrismaMock(existingTenant),
    whatsAppNumbers: { upsertByPhoneNumberId: jest.fn().mockResolvedValue(undefined) },
  };
}

function buildService(deps: ReturnType<typeof buildDeps>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new TenantService(deps.prisma as any, deps.whatsAppNumbers as any);
}

describe('TenantService', () => {
  const existingTenant = { id: 't1', phoneNumberId: 'pn-old', wabaId: 'waba-old', accessToken: 'old-token' };

  describe('update', () => {
    it('syncs WhatsAppNumber when accessToken is sent alone, merging with the tenant\'s existing phoneNumberId/wabaId', async () => {
      // Regression test: a previous version of this sync only fired when
      // phoneNumberId, wabaId, and accessToken were ALL present in the same
      // request. A real caller re-pasting just a fresh access token (the
      // normal "my token expired" flow) silently updated Tenant.accessToken
      // but left the linked WhatsAppNumber.accessToken stale -- which broke
      // real sends once WhatsAppNumber became the thing actually used to
      // send (see the 2026-09-16 production incident).
      const deps = buildDeps(existingTenant);
      const service = buildService(deps);

      await service.update('t1', { accessToken: 'new-token' });

      expect(deps.whatsAppNumbers.upsertByPhoneNumberId).toHaveBeenCalledWith('t1', {
        phoneNumberId: 'pn-old', wabaId: 'waba-old', accessToken: 'new-token',
      });
    });

    it('syncs WhatsAppNumber when only phoneNumberId is sent, keeping the existing accessToken', async () => {
      const deps = buildDeps(existingTenant);
      const service = buildService(deps);

      await service.update('t1', { phoneNumberId: 'pn-new' });

      expect(deps.whatsAppNumbers.upsertByPhoneNumberId).toHaveBeenCalledWith('t1', {
        phoneNumberId: 'pn-new', wabaId: 'waba-old', accessToken: 'old-token',
      });
    });

    it('does not touch WhatsAppNumber when no WhatsApp field is sent', async () => {
      const deps = buildDeps(existingTenant);
      const service = buildService(deps);

      await service.update('t1', { name: 'New Name' });

      expect(deps.whatsAppNumbers.upsertByPhoneNumberId).not.toHaveBeenCalled();
      expect(deps.prisma.tenant.findUniqueOrThrow).toHaveBeenCalledTimes(1); // only the final re-fetch, no pre-fetch needed
    });

    it('does not sync when the tenant has no phoneNumberId/wabaId on record yet and only accessToken is sent', async () => {
      const deps = buildDeps({ id: 't1', phoneNumberId: null, wabaId: null, accessToken: null });
      const service = buildService(deps);

      await service.update('t1', { accessToken: 'new-token' });

      expect(deps.whatsAppNumbers.upsertByPhoneNumberId).not.toHaveBeenCalled();
    });
  });

  describe('updateOnboarding', () => {
    it('syncs WhatsAppNumber when accessToken is sent alone during onboarding', async () => {
      const deps = buildDeps(existingTenant);
      const service = buildService(deps);

      await service.updateOnboarding('t1', { accessToken: 'new-token' });

      expect(deps.whatsAppNumbers.upsertByPhoneNumberId).toHaveBeenCalledWith('t1', {
        phoneNumberId: 'pn-old', wabaId: 'waba-old', accessToken: 'new-token',
      });
    });
  });
});
