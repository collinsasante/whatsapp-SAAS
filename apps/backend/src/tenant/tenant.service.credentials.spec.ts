import { TenantService } from './tenant.service';
import { toPublicTenant } from './tenant-public.util';

const LEGACY_TOKEN = 'EAAB-legacy-whatsapp-token-SECRET';
const AIRTABLE_KEY = 'patAIRTABLE.secret-key-SECRET';
const enc = { encrypt: (v: string) => `enc:v1:${Buffer.from(v).toString('base64')}`, decrypt: (v: string) => (v.startsWith('enc:v1:') ? Buffer.from(v.slice(7), 'base64').toString() : v), isEncrypted: (v?: string | null) => !!v && v.startsWith('enc:v1:') };

function build(row: Record<string, unknown>) {
  const prisma = {
    tenant: { findUnique: jest.fn().mockResolvedValue(row), findUniqueOrThrow: jest.fn().mockResolvedValue(row), update: jest.fn().mockResolvedValue(row) },
    tenantSettings: { upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve({ tenantId: 't1', ...create })) },
  };
  const numbers = { upsertByPhoneNumberId: jest.fn().mockResolvedValue({ id: 'n1' }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service: new TenantService(prisma as any, numbers as any, enc as any), prisma, numbers };
}
const row = { id: 't1', name: 'Acme', phoneNumberId: 'p1', wabaId: 'w1', accessToken: LEGACY_TOKEN, webhookVerifyToken: 'verify-123', settings: { tenantId: 't1', businessName: 'Acme', airtableEnabled: true, airtableApiKey: AIRTABLE_KEY, airtableBaseId: 'app1' } };

describe('GET /tenant exposes no credentials to ordinary workspace members', () => {
  it('findById omits the legacy WhatsApp token and the Airtable key, and says whether a key is saved', async () => {
    const out = await build(row).service.findById('t1');
    const json = JSON.stringify(out);
    expect(json).not.toContain(LEGACY_TOKEN);
    expect(json).not.toContain(AIRTABLE_KEY);
    expect(out).not.toHaveProperty('accessToken');
    expect(out.settings).not.toHaveProperty('airtableApiKey');
    expect(out.settings).toMatchObject({ airtableApiKeyConfigured: true, airtableEnabled: true, airtableBaseId: 'app1', businessName: 'Acme' });
    expect(out).toMatchObject({ id: 't1', name: 'Acme', phoneNumberId: 'p1', wabaId: 'w1', webhookVerifyToken: 'verify-123' });   // everything the dashboard needs is kept
  });

  it('REGRESSION: the same row through the OLD behaviour (raw prisma row) did contain both secrets', async () => {
    expect(JSON.stringify(row)).toContain(LEGACY_TOKEN);
    expect(JSON.stringify(row)).toContain(AIRTABLE_KEY);
  });

  it('handles a tenant without settings and a settings row without a key', () => {
    expect(toPublicTenant({ id: 't', accessToken: 'x', settings: null })).toEqual({ id: 't', settings: null });
    expect(toPublicTenant({ id: 't', settings: { airtableApiKey: null, a: 1 } }).settings).toEqual({ a: 1, airtableApiKeyConfigured: false });
  });

  it('update() and onboarding responses are sanitised too', async () => {
    const { service } = build(row);
    expect(JSON.stringify(await service.update('t1', { name: 'Acme2' } as never))).not.toContain(LEGACY_TOKEN);
    expect(JSON.stringify(await service.updateOnboarding('t1', { step: 2 }))).not.toContain(LEGACY_TOKEN);
  });
});

describe('Airtable key handling in updateSettings', () => {
  it('stores a new key encrypted and never returns it', async () => {
    const { service, prisma } = build(row);
    const out = await service.updateSettings('t1', { airtableApiKey: AIRTABLE_KEY, airtableEnabled: true } as never);
    const stored = prisma.tenantSettings.upsert.mock.calls[0][0].update.airtableApiKey as string;
    expect(stored.startsWith('enc:v1:')).toBe(true);
    expect(stored).not.toContain(AIRTABLE_KEY);
    expect(JSON.stringify(out)).not.toContain(AIRTABLE_KEY);
    expect(out).toMatchObject({ airtableApiKeyConfigured: true });
  });

  it('an empty or missing key means "unchanged": the saved key is never overwritten by the form', async () => {
    const { service, prisma } = build(row);
    await service.updateSettings('t1', { airtableApiKey: '', airtableBaseId: 'app2' } as never);
    await service.updateSettings('t1', { airtableBaseId: 'app3' } as never);
    for (const c of prisma.tenantSettings.upsert.mock.calls) {
      expect(c[0].update).not.toHaveProperty('airtableApiKey');
      expect(c[0].create).not.toHaveProperty('airtableApiKey');
    }
  });

  it('a value that is already ciphertext is stored as is, never encrypted twice', async () => {
    const { service, prisma } = build(row);
    const cipher = enc.encrypt(AIRTABLE_KEY);
    await service.updateSettings('t1', { airtableApiKey: cipher } as never);
    expect(prisma.tenantSettings.upsert.mock.calls[0][0].update.airtableApiKey).toBe(cipher);
  });
});

describe('legacy tenant token merge', () => {
  it('a partial update that re-uses the stored token hands the PLAIN token on, whether the stored value is ciphertext or plaintext', async () => {
    for (const stored of [enc.encrypt(LEGACY_TOKEN), LEGACY_TOKEN]) {
      const { service, numbers } = build({ ...row, accessToken: stored });
      await service.update('t1', { wabaId: 'w2' } as never);
      expect(numbers.upsertByPhoneNumberId).toHaveBeenCalledWith('t1', expect.objectContaining({ accessToken: LEGACY_TOKEN, wabaId: 'w2' }));
    }
  });
});
