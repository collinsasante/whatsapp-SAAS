import { AirtableService } from './airtable.service';

const KEY = 'patAIRTABLE.secret-key-SECRET';
const enc = { decrypt: (v: string) => (v.startsWith('enc:v1:') ? Buffer.from(v.slice(7), 'base64').toString() : v) };

describe('AirtableService key handling', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it.each([
    ['an encrypted key', `enc:v1:${Buffer.from(KEY).toString('base64')}`],
    ['a legacy plaintext key', KEY],
  ])('sends the PLAIN key to Airtable when the stored value is %s', async (_n, stored) => {
    const f = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = f as never;
    const prisma = { tenantSettings: { findUnique: jest.fn().mockResolvedValue({ airtableEnabled: true, airtableApiKey: stored, airtableBaseId: 'app1', airtableTableName: 'Leads' }) } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await new AirtableService(prisma as any, enc as any).pushNewLead('t1', { name: 'A', phone: '+233555000111' });
    expect((f.mock.calls[0][1] as { headers: Record<string, string> }).headers['Authorization']).toBe(`Bearer ${KEY}`);
  });
});
