import { ContactsService } from './contacts.service';

function build() {
  const prisma = {
    contact: {
      upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve({ id: 'c1', name: create.name ?? null, ...create })),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'c1', ...data })),
    },
  };
  const svc = Object.create(ContactsService.prototype) as Record<string, unknown>;
  Object.assign(svc, { prisma });
  return { svc: svc as unknown as ContactsService, prisma };
}

describe('ContactsService identity rules', () => {
  it('identifies a phone contact by tenant + normalized phone only, never by display name', async () => {
    const { svc, prisma } = build();
    await svc.findOrCreate('t1', '0 (233) 555-000111'.replace(/^0 /, ''), 'Breezyyy');
    const call = prisma.contact.upsert.mock.calls[0][0];
    expect(Object.keys(call.where)).toEqual(['tenantId_phone']);
    expect(call.where.tenantId_phone.tenantId).toBe('t1');
    expect(JSON.stringify(call.where)).not.toContain('Breezyyy');
  });

  it('does not store an opaque provider id as the contact name', async () => {
    const { svc, prisma } = build();
    await svc.findOrCreate('t1', '+233555000111', 'GH.1587145059558262');
    expect(prisma.contact.upsert.mock.calls[0][0].create.name).toBeNull();
    expect(prisma.contact.update).not.toHaveBeenCalled();
  });

  it('keeps a real profile name', async () => {
    const { svc, prisma } = build();
    await svc.findOrCreate('t1', '+233555000111', 'Ama Mensah');
    expect(prisma.contact.upsert.mock.calls[0][0].create.name).toBe('Ama Mensah');
  });

  it('stores an anonymous WhatsApp address as its own provider identity with no phone', async () => {
    const { svc, prisma } = build();
    await svc.findOrCreateByExternalId('t1', 'WHATSAPP_JID', '1587145059558262@lid', 'GH.1587145059558262');
    const call = prisma.contact.upsert.mock.calls[0][0];
    expect(call.create).toMatchObject({ tenantId: 't1', externalIdType: 'WHATSAPP_JID', externalId: '1587145059558262@lid', phone: null, name: null });
  });

  it('the same anonymous address in two tenants resolves to two separate contacts', async () => {
    const { svc, prisma } = build();
    await svc.findOrCreateByExternalId('tenant-A', 'WHATSAPP_JID', '1587145059558262@lid');
    await svc.findOrCreateByExternalId('tenant-B', 'WHATSAPP_JID', '1587145059558262@lid');
    const tenants = prisma.contact.upsert.mock.calls.map((c) => c[0].where.tenantId_externalIdType_externalId.tenantId);
    expect(tenants).toEqual(['tenant-A', 'tenant-B']);
  });
});

describe('ContactsService.findOrCreate -- values that are not phone numbers', () => {
  it.each(['status', '', '   ', 'abc', '+', '12'])('rejects %j without touching the database', async (bad) => {
    const { svc, prisma } = build();
    await expect(svc.findOrCreate('t1', bad, 'Someone')).rejects.toThrow('Invalid phone number');
    expect(prisma.contact.upsert).not.toHaveBeenCalled();
  });
});
