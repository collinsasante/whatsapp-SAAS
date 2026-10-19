/**
 * Runs the real Media Library SQL against a real Postgres (every project migration applied).
 * Skipped unless MEDIA_TEST_DATABASE_URL is set, so the normal test run stays hermetic:
 *   MEDIA_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/scratch_db npx jest src/media/media-library.db.spec.ts
 */
import { PrismaClient } from '@prisma/client';
import { MediaService } from './media.service';

const url = process.env['MEDIA_TEST_DATABASE_URL'];
const describeDb = url ? describe : describe.skip;

describeDb('Media Library queries (real database)', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url! } } });
  const service = new MediaService(prisma as never, {} as never);
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const T1 = id(1), T2 = id(2);
  const HUMAN_A = id(11), HUMAN_B = id(12), AI = id(13), OTHER_TENANT_USER = id(14);
  const C1 = id(21), C2 = id(22), CX = id(23);
  const CV1 = id(31), CV2 = id(32), CVX = id(33);
  const CH_CLOUD = id(41), CH_QR = id(42);
  let n = 100;

  async function msg(over: { tenant?: string; conv: string; contact: string; sender?: string | null; dir?: 'INBOUND' | 'OUTBOUND'; type?: string; url: string; caption?: string; at: string }) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO messages (id, tenant_id, conversation_id, contact_id, sender_id, direction, type, status, media_url, media_caption, created_at)
       VALUES ($1,$2,$3,$4,$5,$6::"MessageDirection",$7::"MessageType",'SENT'::"MessageStatus",$8,$9,$10)`,
      id(++n), over.tenant ?? T1, over.conv, over.contact, over.sender ?? null, over.dir ?? 'OUTBOUND', over.type ?? 'IMAGE', over.url, over.caption ?? null, new Date(over.at),
    );
  }

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE tenants CASCADE`);
    for (const [t, slug] of [[T1, 'one'], [T2, 'two']] as const) {
      await prisma.$executeRawUnsafe(`INSERT INTO tenants (id, name, webhook_verify_token, updated_at) VALUES ($1,$2,$3,now())`, t, `Tenant ${slug}`, `verify-${slug}`);
    }
    const users: Array<[string, string, string, string, boolean]> = [
      [HUMAN_A, T1, 'Ama', 'ama@one.test', false], [HUMAN_B, T1, 'Kofi', 'kofi@one.test', false],
      [AI, T1, 'Verz AI', 'ai@one.test', true], [OTHER_TENANT_USER, T2, 'Esi', 'esi@two.test', false],
    ];
    for (const [uid, t, name, email, ai] of users) {
      await prisma.$executeRawUnsafe(`INSERT INTO users (id, tenant_id, email, name, password_hash, role, is_ai_agent, updated_at) VALUES ($1,$2,$3,$4,'x','AGENT'::"UserRole",$5,now())`, uid, t, email, name, ai);
    }
    for (const [c, t, name, phone] of [[C1, T1, 'Customer One', '+233500000001'], [C2, T1, 'Customer Two', '+233500000002'], [CX, T2, 'Other Tenant Customer', '+233500000009']] as const) {
      await prisma.$executeRawUnsafe(`INSERT INTO contacts (id, tenant_id, name, phone, updated_at) VALUES ($1,$2,$3,$4,now())`, c, t, name, phone);
    }
    for (const [ch, t, name, type] of [[CH_CLOUD, T1, 'Cloud', 'WHATSAPP'], [CH_QR, T1, 'QR', 'WHATSAPP_WEB']] as const) {
      await prisma.$executeRawUnsafe(`INSERT INTO channels (id, tenant_id, name, type, updated_at) VALUES ($1,$2,$3,$4::"ChannelType",now())`, ch, t, name, type);
    }
    for (const [cv, t, c, ch] of [[CV1, T1, C1, CH_CLOUD], [CV2, T1, C2, CH_QR], [CVX, T2, CX, null]] as const) {
      await prisma.$executeRawUnsafe(`INSERT INTO conversations (id, tenant_id, contact_id, channel_id, status, updated_at) VALUES ($1,$2,$3,$4,'OPEN'::"ConversationStatus",now())`, cv, t, c, ch);
    }
    // tenant 1
    await msg({ conv: CV1, contact: C1, sender: HUMAN_A, url: 'https://f/a-human.png', at: '2026-10-01T10:00:00Z', caption: 'Receipt' });
    await msg({ conv: CV1, contact: C1, sender: HUMAN_B, type: 'DOCUMENT', url: 'https://f/b-human.pdf', at: '2026-10-02T10:00:00Z' });
    await msg({ conv: CV2, contact: C2, sender: HUMAN_A, type: 'VIDEO', url: 'https://f/a-video.mp4', at: '2026-10-03T10:00:00Z' });
    await msg({ conv: CV1, contact: C1, sender: AI, url: 'https://f/ai-sent.png', at: '2026-10-04T10:00:00Z' });
    await msg({ conv: CV1, contact: C1, sender: null, url: 'https://f/automation.png', at: '2026-10-05T10:00:00Z' });
    await msg({ conv: CV1, contact: C1, dir: 'INBOUND', url: 'https://f/customer.png', at: '2026-10-06T10:00:00Z', caption: 'my photo' });
    await msg({ conv: CV2, contact: C2, dir: 'INBOUND', type: 'AUDIO', url: 'https://f/customer.ogg', at: '2026-10-07T10:00:00Z' });
    // the SAME file sent twice by a human (older + newer): one row, the newer message
    await msg({ conv: CV1, contact: C1, sender: HUMAN_A, url: 'https://f/dup.png', at: '2026-10-08T10:00:00Z' });
    await msg({ conv: CV2, contact: C2, sender: HUMAN_A, url: 'https://f/dup.png', at: '2026-10-09T10:00:00Z' });
    // tenant 2 (must never appear for tenant 1, even though a tenant-1 user could not send there)
    await msg({ tenant: T2, conv: CVX, contact: CX, sender: OTHER_TENANT_USER, url: 'https://f/tenant2.png', at: '2026-10-10T10:00:00Z' });
    await msg({ tenant: T2, conv: CVX, contact: CX, dir: 'INBOUND', url: 'https://f/tenant2-customer.png', at: '2026-10-11T10:00:00Z' });
  });
  afterAll(async () => { await prisma.$executeRawUnsafe(`TRUNCATE tenants CASCADE`); await prisma.$disconnect(); });

  const urls = (r: { data: Array<{ mediaUrl: string }> }) => r.data.map((d) => d.mediaUrl.replace('https://f/', ''));

  it('All Media: every file in the workspace once, newest first, never another tenant\'s', async () => {
    const r = await service.findMessageMedia(T1, 1, 50);
    expect(urls(r)).toEqual(['dup.png', 'customer.ogg', 'customer.png', 'automation.png', 'ai-sent.png', 'a-video.mp4', 'b-human.pdf', 'a-human.png']);
    expect(r.meta.total).toBe(8);
    expect(urls(r).some((u) => u.startsWith('tenant2'))).toBe(false);
  });

  it('a file sent twice is one row, showing the most recent message and conversation', async () => {
    const r = await service.findMessageMedia(T1, 1, 50);
    const dup = r.data.find((d) => d.mediaUrl.endsWith('dup.png'))!;
    expect(dup.createdAt).toEqual(new Date('2026-10-09T10:00:00Z'));
    expect(dup.conversation.id).toBe(CV2);
  });

  it('Sent by Agents: only outbound files from real people. AI, automation and customer files are excluded', async () => {
    const r = await service.findMessageMedia(T1, 1, 50, { source: 'agents' });
    expect(urls(r)).toEqual(['dup.png', 'a-video.mp4', 'b-human.pdf', 'a-human.png']);
    expect(urls(r)).not.toContain('ai-sent.png');
    expect(urls(r)).not.toContain('automation.png');
    expect(urls(r)).not.toContain('customer.png');
    expect(r.meta.total).toBe(4);
    for (const row of r.data) expect(row.sender).toMatchObject({ isAiAgent: false });
  });

  it('filters by one agent, and that agent\'s total matches the agent list count', async () => {
    const ama = await service.findMessageMedia(T1, 1, 50, { agentId: HUMAN_A });
    expect(urls(ama)).toEqual(['dup.png', 'a-video.mp4', 'a-human.png']);
    const agents = await service.listMediaAgents(T1);
    expect(agents).toEqual([{ id: HUMAN_A, name: 'Ama', count: 3 }, { id: HUMAN_B, name: 'Kofi', count: 1 }]);
    expect(agents.some((a) => a.id === AI || a.id === OTHER_TENANT_USER)).toBe(false);
  });

  it('asking for the AI user as an "agent" returns nothing (the AI is never misclassified as a human)', async () => {
    expect((await service.findMessageMedia(T1, 1, 50, { agentId: AI })).data).toEqual([]);
  });

  it('another tenant\'s agent id returns nothing for this tenant', async () => {
    expect((await service.findMessageMedia(T1, 1, 50, { agentId: OTHER_TENANT_USER })).data).toEqual([]);
  });

  it('filters by media type, channel, direction and date range, and they combine', async () => {
    expect(urls(await service.findMessageMedia(T1, 1, 50, { type: 'DOCUMENT' }))).toEqual(['b-human.pdf']);
    expect(urls(await service.findMessageMedia(T1, 1, 50, { channelType: 'WHATSAPP_WEB' }))).toEqual(['dup.png', 'customer.ogg', 'a-video.mp4']);
    expect(urls(await service.findMessageMedia(T1, 1, 50, { direction: 'INBOUND' }))).toEqual(['customer.ogg', 'customer.png']);
    expect(urls(await service.findMessageMedia(T1, 1, 50, { from: '2026-10-02', to: '2026-10-04' }))).toEqual(['ai-sent.png', 'a-video.mp4', 'b-human.pdf']);
    expect(urls(await service.findMessageMedia(T1, 1, 50, { source: 'agents', channelType: 'WHATSAPP_WEB', type: 'VIDEO' }))).toEqual(['a-video.mp4']);
  });

  it('the end date includes the whole last day', async () => {
    expect(urls(await service.findMessageMedia(T1, 1, 50, { from: '2026-10-09', to: '2026-10-09' }))).toEqual(['dup.png']);
  });

  it('searches contact names and captions, treating % and _ literally', async () => {
    expect(urls(await service.findMessageMedia(T1, 1, 50, { search: 'customer two' }))).toEqual(['dup.png', 'customer.ogg', 'a-video.mp4']);
    expect(urls(await service.findMessageMedia(T1, 1, 50, { search: 'receipt' }))).toEqual(['a-human.png']);
    expect((await service.findMessageMedia(T1, 1, 50, { search: '%' })).data).toEqual([]);
    expect((await service.findMessageMedia(T1, 1, 50, { search: "x'; DROP TABLE messages;--" })).data).toEqual([]);
  });

  it('paginates distinct files with no gaps, no repeats, and a correct total', async () => {
    const seen: string[] = [];
    for (let p = 1; p <= 3; p++) {
      const r = await service.findMessageMedia(T1, p, 3);
      expect(r.meta.total).toBe(8);
      seen.push(...urls(r));
    }
    expect(seen).toHaveLength(8);
    expect(new Set(seen).size).toBe(8);
    expect((await service.findMessageMedia(T1, 4, 3)).data).toEqual([]);
  });

  it('the other tenant sees only its own two files', async () => {
    const r = await service.findMessageMedia(T2, 1, 50);
    expect(urls(r).sort()).toEqual(['tenant2-customer.png', 'tenant2.png']);
    expect(r.meta.total).toBe(2);
  });

  it('rejects unknown filter values instead of passing them to SQL', async () => {
    await expect(service.findMessageMedia(T1, 1, 50, { type: 'EXE' })).rejects.toThrow('Unknown media type');
    await expect(service.findMessageMedia(T1, 1, 50, { channelType: 'FAX' })).rejects.toThrow('Unknown channel');
    await expect(service.findMessageMedia(T1, 1, 50, { source: 'everyone' as never })).rejects.toThrow('Source must be');
    await expect(service.findMessageMedia(T1, 1, 50, { agentId: "1' OR '1'='1" })).rejects.toThrow('Unknown agent');
    await expect(service.findMessageMedia(T1, 1, 50, { from: 'nope' })).rejects.toThrow('valid date');
    await expect(service.findMessageMedia(T1, 1, 50, { source: 'agents', direction: 'INBOUND' })).rejects.toThrow('always outbound');
  });
});
