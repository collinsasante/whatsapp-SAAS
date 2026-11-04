/**
 * Messenger history import against a REAL Postgres (every table from schema.prisma). Only Meta's Graph API is faked here, so this proves our
 * persistence, idempotency, pagination, resume, isolation and error handling, NOT that Meta serves a particular Page's history (that is checked
 * separately against the real API on staging). Skipped unless MSGSYNC_TEST_DATABASE_URL is set:
 *   MSGSYNC_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/msgsync_test npx jest src/facebook-messenger/messenger-history-sync.db.spec.ts
 */
import { PrismaClient } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { MessengerHistorySyncService } from './messenger-history-sync.service';
import { ContactsService } from '../contacts/contacts.service';

const url = process.env['MSGSYNC_TEST_DATABASE_URL'];
if (url && !/(test|scratch|tmp)/i.test(new URL(url).pathname)) throw new Error('MSGSYNC_TEST_DATABASE_URL must name a throwaway database (contains "test", "scratch" or "tmp").');
const describeDb = url ? describe : describe.skip;

const PAGE_A = '1000000000000001';
const PAGE_B = '2000000000000002';
const TOKEN_A = 'PAGE-TOKEN-A-SECRET';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

type Conv = { id: string; updated_time: string; psid: string; name: string; messages: Array<{ id: string; t: string; from: 'page' | 'user'; text?: string; mime?: string }> };

describeDb('MessengerHistorySyncService (real database, faked Meta)', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? 'postgresql://skipped:skipped@127.0.0.1:1/skipped' } } });
  const encryption = { decrypt: (v: string) => v.replace(/^enc:/, ''), encrypt: (v: string) => `enc:${v}` };
  const service = new MessengerHistorySyncService(prisma as never, encryption as never, new ContactsService(prisma as never, {} as never));
  service.sleep = async () => undefined;
  const logs: string[] = [];
  const realFetch = global.fetch;

  const T1 = id(1), T2 = id(2), CH1 = id(11), CH2 = id(12), CH_WA = id(13);

  // ---- a fake Graph API -------------------------------------------------------------------------------------------------------------------
  let metaConvs: Conv[] = [];
  let failure: ((url: URL) => { status: number; body: unknown } | null) | null = null;
  const calls: URL[] = [];
  function installMeta(pageId = PAGE_A) {
    global.fetch = (async (input: string | URL | Request) => {
      const u = new URL(String(input));
      calls.push(u);
      const f = failure?.(u);
      if (f) return { ok: f.status < 400, status: f.status, json: async () => f.body } as Response;
      const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
      const limit = Number(u.searchParams.get('limit') ?? 25); const after = Number(u.searchParams.get('after') ?? 0);
      const paginate = <T>(all: T[]) => {
        const slice = all.slice(after, after + limit); const nextAfter = after + limit;
        return { data: slice, ...(nextAfter < all.length && { paging: { cursors: { after: String(nextAfter) }, next: `https://graph.facebook.com/next?after=${nextAfter}` } }) };
      };
      if (u.pathname.endsWith('/me/conversations')) {
        const sorted = [...metaConvs].sort((a, b) => b.updated_time.localeCompare(a.updated_time));
        return ok(paginate(sorted.map((c) => ({ id: c.id, updated_time: c.updated_time, participants: { data: [{ id: pageId, name: 'The Page' }, { id: c.psid, name: c.name }] } }))));
      }
      const m = u.pathname.match(/\/(t_[^/]+)\/messages$/);
      if (m) {
        const conv = metaConvs.find((c) => c.id === m[1]);
        const sorted = [...(conv?.messages ?? [])].sort((a, b) => b.t.localeCompare(a.t));
        return ok(paginate(sorted.map((x) => ({
          id: x.id, created_time: x.t, from: { id: x.from === 'page' ? pageId : conv!.psid }, message: x.text,
          ...(x.mime && { attachments: { data: [{ mime_type: x.mime, name: 'f' }] } }),
        }))));
      }
      return { ok: false, status: 404, json: async () => ({ error: { code: 100, message: 'unknown path' } }) } as Response;
    }) as typeof fetch;
  }
  const mkConv = (n: number, msgs: number, over: Partial<Conv> = {}): Conv => ({
    id: `t_${n}`, updated_time: `2026-10-${String(10 + (n % 15)).padStart(2, '0')}T10:00:00+0000`, psid: `psid-${n}`, name: `Person ${n}`,
    messages: Array.from({ length: msgs }, (_, i) => ({ id: `m_${n}_${i}`, t: `2026-10-01T10:${String(i % 60).padStart(2, '0')}:${String(Math.floor(i / 60)).padStart(2, '0')}+0000`, from: i % 2 ? 'page' : 'user', text: `secret body ${n}-${i}` })),
    ...over,
  });
  const settle = async (channelId: string) => { await service.running.get(channelId); };
  const state = (channelId: string) => prisma.channelHistorySync.findUniqueOrThrow({ where: { channelId } });
  const count = (where: object) => prisma.message.count({ where });

  beforeAll(async () => {
    for (const m of ['log', 'warn', 'error', 'debug'] as const) jest.spyOn(Logger.prototype, m).mockImplementation((msg: unknown) => { logs.push(String(msg)); });
    await prisma.$executeRawUnsafe('TRUNCATE tenants CASCADE');
    for (const [t, n] of [[T1, 'one'], [T2, 'two']] as const) await prisma.$executeRawUnsafe(`INSERT INTO tenants (id, name, webhook_verify_token, updated_at) VALUES ($1,$2,$3,now())`, t, `Tenant ${n}`, `verify-${n}`);
    for (const [c, t, type, name] of [[CH1, T1, 'FACEBOOK_MESSENGER', 'Page A'], [CH2, T2, 'FACEBOOK_MESSENGER', 'Page B'], [CH_WA, T1, 'WHATSAPP', 'WA']] as const)
      await prisma.$executeRawUnsafe(`INSERT INTO channels (id, tenant_id, type, name, is_active, credentials, metadata, updated_at) VALUES ($1,$2,$3::"ChannelType",$4,true,'{}','{}',now())`, c, t, type, name);
    for (const [c, t, page] of [[CH1, T1, PAGE_A], [CH2, T2, PAGE_B]] as const)
      await prisma.$executeRawUnsafe(`INSERT INTO facebook_page_connections (id, tenant_id, channel_id, page_id, page_name, page_access_token, is_active, updated_at) VALUES ($1,$2,$3,$4,'Page',$5,true,now())`, `00000000-0000-4000-8000-0000000001${page.slice(-2)}`, t, c, page, `enc:${page === PAGE_A ? TOKEN_A : 'PAGE-TOKEN-B'}`);
  });
  afterAll(async () => { global.fetch = realFetch; jest.restoreAllMocks(); await prisma.$disconnect(); });
  beforeEach(async () => {
    logs.length = 0; calls.length = 0; failure = null; metaConvs = []; installMeta();
    await prisma.$executeRawUnsafe('TRUNCATE messages, conversations, contacts, channel_history_syncs CASCADE');
  });

  // ---- tests ------------------------------------------------------------------------------------------------------------------------------
  it('imports every conversation and every message across multiple pages, with the right direction, times and tenant/channel', async () => {
    metaConvs = [mkConv(1, 60), mkConv(2, 3), ...Array.from({ length: 30 }, (_, i) => mkConv(10 + i, 2))];
    const started = await service.start(T1, CH1);
    expect(started.status).toBe('SYNCING');
    await settle(CH1);

    const s = await state(CH1);
    expect(s.status).toBe('COMPLETED');
    expect(s).toMatchObject({ conversationsDiscovered: 32, conversationsImported: 32, conversationsFailed: 0, messagesDiscovered: 123, messagesImported: 123, messagesSkipped: 0 });
    expect(await prisma.conversation.count({ where: { tenantId: T1, channelId: CH1 } })).toBe(32);
    expect(await count({ tenantId: T1, channelId: CH1 })).toBe(123);
    const conv1 = await prisma.contact.findFirstOrThrow({ where: { tenantId: T1, externalId: 'psid-1' } });
    expect(conv1).toMatchObject({ externalIdType: 'MESSENGER_PSID', name: 'Person 1' });
    const msgs = await prisma.message.findMany({ where: { tenantId: T1, contactId: conv1.id }, orderBy: { createdAt: 'asc' } });
    expect(msgs).toHaveLength(60);
    expect(msgs[0]!.direction).toBe('INBOUND');   // index 0 = from the user
    expect(msgs[1]!.direction).toBe('OUTBOUND');  // index 1 = from the Page
    expect(msgs[1]!.status).toBe('SENT');
    expect(msgs[0]!.createdAt.toISOString()).toBe('2026-10-01T10:00:00.000Z');
    expect(msgs.every((m) => (m.metadata as { imported?: boolean }).imported === true)).toBe(true);
    expect(calls.filter((u) => u.pathname.endsWith('/me/conversations')).length).toBe(2);        // 32 conversations at 25 per page
    expect(calls.filter((u) => u.pathname.endsWith('/t_1/messages')).length).toBe(3);            // 60 messages at 25 per page
    expect(calls.every((u) => u.searchParams.get('access_token') === TOKEN_A)).toBe(true);        // only this Page's token was used
  });

  it('imported conversations appear in the default inbox query (OPEN, no unread flood), newest activity first', async () => {
    metaConvs = [mkConv(1, 4, { updated_time: '2026-10-20T00:00:00+0000' }), mkConv(2, 4, { updated_time: '2026-10-25T00:00:00+0000' })];
    await service.start(T1, CH1); await settle(CH1);
    const { ConversationsService } = await import('../conversations/conversations.service');
    type Row = { id: string; status: string; unreadCount: number; channelId: string; lastMessageAt: Date | null; messages: unknown[] };
    const findAll = ConversationsService.prototype.findAll as unknown as (this: { prisma: PrismaClient }, ...a: unknown[]) => Promise<{ data: Row[]; meta: { total: number } }>;
    const list = await findAll.call({ prisma }, T1, 1, 25);
    expect(list.meta.total).toBe(2);
    expect(list.data.every((c: Row) => c.status === 'OPEN' && c.unreadCount === 0 && c.channelId === CH1)).toBe(true);
    expect(list.data.every((c: Row) => c.messages.length === 1 && c.lastMessageAt !== null)).toBe(true);
    expect(list.data[0]!.lastMessageAt!.getTime()).toBeGreaterThanOrEqual(list.data[1]!.lastMessageAt!.getTime());
  });

  it('running it again changes nothing: no duplicate conversations, contacts or messages (reconnect safe)', async () => {
    metaConvs = [mkConv(1, 30), mkConv(2, 5)];
    await service.start(T1, CH1); await settle(CH1);
    const before = { m: await count({ tenantId: T1 }), c: await prisma.conversation.count({ where: { tenantId: T1 } }), k: await prisma.contact.count({ where: { tenantId: T1 } }) };
    await service.start(T1, CH1); await settle(CH1);
    expect({ m: await count({ tenantId: T1 }), c: await prisma.conversation.count({ where: { tenantId: T1 } }), k: await prisma.contact.count({ where: { tenantId: T1 } }) }).toEqual(before);
    expect((await state(CH1)).status).toBe('COMPLETED');
  });

  it('webhook/import overlap: a message already stored by the webhook is skipped, not duplicated, and its stored fields are never overwritten', async () => {
    metaConvs = [mkConv(1, 4)];
    const contact = await prisma.contact.create({ data: { tenantId: T1, externalIdType: 'MESSENGER_PSID', externalId: 'psid-1', name: 'From Webhook' } });
    const conv = await prisma.conversation.create({ data: { tenantId: T1, contactId: contact.id, channelId: CH1, status: 'REQUESTED', unreadCount: 3, lastMessageAt: new Date('2026-11-03T09:00:00Z') } });
    await prisma.message.create({ data: { tenantId: T1, conversationId: conv.id, contactId: contact.id, channelId: CH1, whatsappMessageId: 'm_1_2', direction: 'INBOUND', type: 'TEXT', status: 'READ', content: 'live version' } });

    await service.start(T1, CH1); await settle(CH1);

    expect(await count({ tenantId: T1, whatsappMessageId: 'm_1_2' })).toBe(1);
    expect((await prisma.message.findFirstOrThrow({ where: { tenantId: T1, whatsappMessageId: 'm_1_2' } })).content).toBe('live version');
    expect(await count({ tenantId: T1 })).toBe(4);
    expect(await prisma.conversation.count({ where: { tenantId: T1 } })).toBe(1);                        // joined the existing conversation
    const after = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(after.lastMessageAt!.toISOString()).toBe('2026-11-03T09:00:00.000Z');                         // older import did not rewind it
    expect(after).toMatchObject({ status: 'REQUESTED', unreadCount: 3 });                                  // state untouched
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).name).toBe('From Webhook');
    expect((await state(CH1)).messagesSkipped).toBe(1);
  });

  it('moves lastMessageAt forward when the imported history is newer than what is stored', async () => {
    metaConvs = [mkConv(1, 3)];
    const contact = await prisma.contact.create({ data: { tenantId: T1, externalIdType: 'MESSENGER_PSID', externalId: 'psid-1' } });
    const conv = await prisma.conversation.create({ data: { tenantId: T1, contactId: contact.id, channelId: CH1, lastMessageAt: new Date('2020-01-01T00:00:00Z') } });
    await service.start(T1, CH1); await settle(CH1);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })).lastMessageAt!.toISOString()).toBe('2026-10-01T10:02:00.000Z');
  });

  it('incremental: a later run imports only conversations updated since the last completed run and stops early', async () => {
    metaConvs = [mkConv(1, 4, { updated_time: '2026-10-10T00:00:00+0000' }), mkConv(2, 4, { updated_time: '2026-10-11T00:00:00+0000' })];
    await service.start(T1, CH1); await settle(CH1);
    expect((await state(CH1)).watermark!.toISOString()).toBe('2026-10-11T00:00:00.000Z');

    metaConvs.push(mkConv(3, 2, { updated_time: '2026-10-12T00:00:00+0000' }));
    metaConvs[1]!.messages.push({ id: 'm_2_new', t: '2026-10-12T01:00:00+0000', from: 'user', text: 'newer' }); metaConvs[1]!.updated_time = '2026-10-12T01:00:00+0000';
    calls.length = 0;
    await service.start(T1, CH1); await settle(CH1);
    const s = await state(CH1);
    expect(s).toMatchObject({ status: 'COMPLETED', conversationsDiscovered: 2, messagesImported: 3 });  // conv 3 (2 msgs) + the 1 new message of conv 2
    expect(calls.filter((u) => u.pathname.endsWith('/t_1/messages')).length).toBe(0);                    // the untouched conversation was never fetched
    expect(await count({ tenantId: T1 })).toBe(8 + 3);
  });

  it('rate limiting: retries with backoff and succeeds when Meta recovers', async () => {
    metaConvs = [mkConv(1, 2)];
    let n = 0; const sleeps: number[] = []; service.sleep = async (ms) => { sleeps.push(ms); };
    failure = (u) => (u.pathname.endsWith('/me/conversations') && n++ < 2 ? { status: 400, body: { error: { code: 4, message: 'Application request limit reached' } } } : null);
    await service.start(T1, CH1); await settle(CH1);
    expect((await state(CH1)).status).toBe('COMPLETED');
    expect(sleeps).toEqual([1000, 2000]);
    service.sleep = async () => undefined;
  });

  it('persistent rate limiting: ends PARTIAL with a resumable checkpoint, then a retry resumes and completes without redoing finished pages', async () => {
    metaConvs = Array.from({ length: 60 }, (_, i) => mkConv(100 + i, 1, { updated_time: `2026-10-${String(1 + Math.floor(i / 2)).padStart(2, '0')}T00:00:00+0000` }));
    let limited = false;
    failure = (u) => (limited && u.pathname.endsWith('/me/conversations') && u.searchParams.get('after') === '25' ? { status: 429, body: { error: { code: 17, message: 'User request limit reached' } } } : null);
    // limit starts when the second conversations page is asked for
    limited = true;
    await service.start(T1, CH1); await settle(CH1);
    let s = await state(CH1);
    expect(s.status).toBe('PARTIAL');
    expect(s.lastErrorCode).toBe(17);
    expect(s.cursor).toBe('25');
    expect(s.conversationsImported).toBe(25);
    expect(logs.join('\n')).toContain('"event":"sync_finished"');

    limited = false; calls.length = 0;
    const resumed = await service.getStatus(T1, CH1);
    expect(resumed.resumable).toBe(true);
    await service.start(T1, CH1); await settle(CH1);
    s = await state(CH1);
    expect(s.status).toBe('COMPLETED');
    expect(await prisma.conversation.count({ where: { tenantId: T1 } })).toBe(60);
    expect(await count({ tenantId: T1 })).toBe(60);
    expect(calls.filter((u) => u.pathname.endsWith('/me/conversations') && !u.searchParams.get('after')).length).toBe(0); // did not start over
  });

  it.each([
    ['expired token', 190, 'FAILED', 'Reconnect the Page'],
    ['missing permission', 200, 'FAILED', 'permission'],
  ])('%s: the run FAILS clearly with Meta\'s code, nothing is imported, and the checkpoint is kept', async (_n, code, status, text) => {
    metaConvs = [mkConv(1, 2)];
    failure = () => ({ status: 400, body: { error: { code, message: `Error validating access token: Session expired token=${TOKEN_A}` } } });
    await service.start(T1, CH1); await settle(CH1);
    const s = await state(CH1);
    expect(s.status).toBe(status);
    expect(s.lastErrorCode).toBe(code);
    expect(s.lastError).toContain(text);
    expect(s.lastError).not.toContain(TOKEN_A);
    expect(await count({ tenantId: T1 })).toBe(0);
    expect(calls.length).toBe(1);   // auth/permission errors are not retried
  });

  it('a conversation that fails to store is counted, the others still import, the run is PARTIAL, and a re-run completes it', async () => {
    metaConvs = [mkConv(1, 2), mkConv(2, 2), mkConv(3, 2)];
    const spy = jest.spyOn(prisma.message, 'createMany').mockRejectedValueOnce(new Error('simulated db failure for one conversation'));
    await service.start(T1, CH1); await settle(CH1);
    let s = await state(CH1);
    expect(s).toMatchObject({ status: 'PARTIAL', conversationsFailed: 1, conversationsImported: 2 });
    expect(s.watermark).toBeNull();           // a partial run must not advance the incremental watermark
    spy.mockRestore();
    await service.start(T1, CH1); await settle(CH1);
    s = await state(CH1);
    expect(s.status).toBe('COMPLETED');
    expect(await count({ tenantId: T1 })).toBe(6);
  });

  it('tenant and Page isolation: two workspaces with their own Pages never see each other\'s data, and a sync only uses its own Page token', async () => {
    metaConvs = [mkConv(1, 3)];
    await service.start(T1, CH1); await settle(CH1);
    installMeta(PAGE_B); metaConvs = [mkConv(7, 5)]; calls.length = 0;
    await service.start(T2, CH2); await settle(CH2);
    expect(await count({ tenantId: T1 })).toBe(3);
    expect(await count({ tenantId: T2 })).toBe(5);
    expect(await prisma.contact.count({ where: { tenantId: T1, externalId: 'psid-7' } })).toBe(0);
    expect(await prisma.contact.count({ where: { tenantId: T2, externalId: 'psid-1' } })).toBe(0);
    expect(calls.every((u) => u.searchParams.get('access_token') === 'PAGE-TOKEN-B')).toBe(true);
    // another tenant cannot start, read or learn about this channel
    await expect(service.start(T2, CH1)).rejects.toThrow('Channel not found');
    await expect(service.getStatus(T2, CH1)).rejects.toThrow('Channel not found');
  });

  it('only Facebook Messenger channels can be synced: a WhatsApp channel is refused and untouched', async () => {
    await expect(service.start(T1, CH_WA)).rejects.toThrow('only available for Facebook Messenger');
    expect(await prisma.channelHistorySync.count({ where: { channelId: CH_WA } })).toBe(0);
  });

  it('does not run twice at once: a second start while a run is active returns the active run', async () => {
    metaConvs = [mkConv(1, 80)];
    const a = await service.start(T1, CH1);
    const b = await service.start(T1, CH1);
    expect(a.status).toBe('SYNCING'); expect(b.status).toBe('SYNCING');
    await settle(CH1);
    expect((await state(CH1)).attempts).toBe(1);
    expect(await count({ tenantId: T1 })).toBe(80);
  });

  it('a stale SYNCING row (process died) is taken over and resumed from its cursor', async () => {
    metaConvs = Array.from({ length: 40 }, (_, i) => mkConv(200 + i, 1));
    await prisma.channelHistorySync.create({ data: { tenantId: T1, channelId: CH1, status: 'SYNCING', cursor: '25', heartbeatAt: new Date(Date.now() - 10 * 60_000), attempts: 1 } });
    await service.start(T1, CH1); await settle(CH1);
    const s = await state(CH1);
    expect(s).toMatchObject({ status: 'COMPLETED', attempts: 2 });
    expect(await prisma.conversation.count({ where: { tenantId: T1 } })).toBe(15);   // only the part after the checkpoint
  });

  it('attachments and stickers become labelled placeholders (Meta\'s attachment URLs expire); an empty message gets an honest label', async () => {
    metaConvs = [mkConv(1, 0, { messages: [
      { id: 'a1', t: '2026-10-01T10:00:00+0000', from: 'user', mime: 'image/jpeg' },
      { id: 'a2', t: '2026-10-01T10:01:00+0000', from: 'user', mime: 'audio/mpeg' },
      { id: 'a3', t: '2026-10-01T10:02:00+0000', from: 'user' },
    ] })];
    await service.start(T1, CH1); await settle(CH1);
    const rows = await prisma.message.findMany({ where: { tenantId: T1 }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => r.type)).toEqual(['IMAGE', 'AUDIO', 'TEXT']);
    expect(rows[0]!.content).toContain('Image');
    expect(rows[0]!.mediaUrl).toBeNull();
    expect(rows[2]!.content).toContain('not available');
  });

  it('logs are structured and carry no message text, names, tokens or full ids', async () => {
    metaConvs = [mkConv(1, 4)];
    failure = (u) => (u.pathname.endsWith('/t_1/messages') ? null : null);
    await service.start(T1, CH1); await settle(CH1);
    const all = logs.join('\n');
    expect(all).toContain('"event":"sync_started"');
    expect(all).toContain('"event":"sync_finished"');
    expect(all).toMatch(/"correlationId":"[0-9a-f-]{36}"/);
    for (const secret of [TOKEN_A, 'secret body', 'Person 1', T1, CH1, PAGE_A, 'psid-1']) expect(all).not.toContain(secret);
    const fin = JSON.parse(logs.find((l) => l.includes('"event":"sync_finished"'))!);
    expect(fin).toMatchObject({ status: 'COMPLETED', conversations: { discovered: 1, imported: 1 }, messages: { discovered: 4, imported: 4 } });
  });

  it('regression: importing Messenger history leaves other channels\' conversations and messages untouched', async () => {
    const contact = await prisma.contact.create({ data: { tenantId: T1, phone: '+233555000111', name: 'WA customer' } });
    const conv = await prisma.conversation.create({ data: { tenantId: T1, contactId: contact.id, channelId: CH_WA, status: 'OPEN', unreadCount: 2, lastMessageAt: new Date('2026-11-01T00:00:00Z') } });
    await prisma.message.create({ data: { tenantId: T1, conversationId: conv.id, contactId: contact.id, channelId: CH_WA, whatsappMessageId: 'wamid.X', direction: 'INBOUND', type: 'TEXT', status: 'DELIVERED', content: 'hello' } });
    metaConvs = [mkConv(1, 5)];
    await service.start(T1, CH1); await settle(CH1);
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })).toMatchObject({ status: 'OPEN', unreadCount: 2, channelId: CH_WA });
    expect(await count({ conversationId: conv.id })).toBe(1);
    expect(await count({ channelId: CH_WA })).toBe(1);
  });
});
