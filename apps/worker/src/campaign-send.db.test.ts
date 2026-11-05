import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import axios, { AxiosError } from 'axios';
import { PrismaClient } from '@prisma/client';
import { CampaignSendWorker } from './processors/campaign-send.processor';
import { CLAIM_LEASE_MS, UNKNOWN_DELIVERY_REASON, claimRecipient, closeStaleClaims, recordAccepted, recordFailed } from './lib/campaign-claims';

// Real PostgreSQL, real processor, stubbed Meta call. Skipped unless WORKER_TEST_DATABASE_URL names a LOCAL database whose name ends in "test"
// (the suite creates and deletes its own tenants). The schema must include migration 20261110120000_campaign_recipient_claims.
const url = process.env['WORKER_TEST_DATABASE_URL'];
const safe = (() => {
  if (!url) return false;
  const u = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(u.hostname) || !u.pathname.slice(1).endsWith('test')) throw new Error(`Refusing to run against ${u.hostname}${u.pathname}`);
  return true;
})();
const skip = !safe && 'WORKER_TEST_DATABASE_URL not set';

const prisma = safe ? new PrismaClient({ datasources: { db: { url } } }) : (undefined as unknown as PrismaClient);
const CONN = { host: '127.0.0.1', port: 6379 };
const tenants: string[] = [];

interface Seed { tenantId: string; campaignId: string; recipientIds: string[]; phones: string[] }

async function seed(n: number, opts: { optedOutIndex?: number } = {}): Promise<Seed> {
  const tag = randomUUID().slice(0, 8);
  const tenant = await prisma.tenant.create({ data: { name: `claims-${tag}`, webhookVerifyToken: randomUUID(), phoneNumberId: 'phone-number-id', accessToken: 'plain-test-token' } });
  tenants.push(tenant.id);
  const user = await prisma.user.create({ data: { tenantId: tenant.id, name: 'Owner', email: `o-${tag}@example.test`, passwordHash: 'x', role: 'ADMIN' } });
  const template = await prisma.template.create({ data: { tenantId: tenant.id, name: 'promo', language: 'en', status: 'APPROVED', components: [{ type: 'BODY', text: 'Hello' }] } });
  const campaign = await prisma.campaign.create({ data: { tenantId: tenant.id, name: 'c', status: 'RUNNING', templateId: template.id, createdById: user.id, totalRecipients: n } });
  const phones: string[] = []; const recipientIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const phone = `+2332010${String(i).padStart(5, '0')}${tag.slice(0, 2).replace(/\D/g, '1')}`;
    phones.push(phone);
    const contact = await prisma.contact.create({ data: { tenantId: tenant.id, phone, name: `C${i}`, optedOut: opts.optedOutIndex === i } });
    const r = await prisma.campaignRecipient.create({ data: { campaignId: campaign.id, contactId: contact.id } });
    recipientIds.push(r.id);
  }
  return { tenantId: tenant.id, campaignId: campaign.id, recipientIds, phones };
}

type PostFn = (url: string, body: { to: string }) => Promise<unknown>;
function stubMeta(handler: PostFn) {
  const calls: string[] = [];
  const real = axios.post;
  (axios as unknown as { post: unknown }).post = async (u: string, body: { to: string }) => { calls.push(body.to); return handler(u, body); };
  return { calls, restore: () => { (axios as unknown as { post: unknown }).post = real; } };
}
const accept = (to: string) => ({ data: { messages: [{ id: `wamid.${to}` }] } });
const job = (s: Seed, ids = s.recipientIds) => ({ data: { campaignId: s.campaignId, tenantId: s.tenantId, batchIndex: 0, recipientIds: ids } });
const worker = (now = () => new Date()) => new CampaignSendWorker(prisma, CONN, now, 0);
const rows = (s: Seed) => prisma.campaignRecipient.findMany({ where: { campaignId: s.campaignId }, orderBy: { id: 'asc' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => Promise<boolean> | boolean, ms = 5000) { const end = Date.now() + ms; while (!(await cond())) { if (Date.now() > end) throw new Error('condition not reached'); await sleep(20); } }

test.after(async () => {
  if (!safe) return;
  for (const id of tenants) await prisma.tenant.delete({ where: { id } }).catch(() => undefined);
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------------------------------------------- the state machine
test('exactly one of many concurrent claimants wins a recipient', { skip }, async () => {
  const s = await seed(1);
  const wins = await Promise.all(Array.from({ length: 25 }, () => claimRecipient(prisma, s.recipientIds[0]!, s.campaignId, randomUUID(), new Date())));
  assert.equal(wins.filter(Boolean).length, 1);
});

test('a claimed recipient cannot be claimed again, even by the same worker', { skip }, async () => {
  const s = await seed(1);
  assert.equal(await claimRecipient(prisma, s.recipientIds[0]!, s.campaignId, 't1', new Date()), true);
  assert.equal(await claimRecipient(prisma, s.recipientIds[0]!, s.campaignId, 't1', new Date()), false);
});

test('only the claim holder can record an outcome, and only once', { skip }, async () => {
  const s = await seed(1); const id = s.recipientIds[0]!;
  await claimRecipient(prisma, id, s.campaignId, 'mine', new Date());
  assert.equal(await recordAccepted(prisma, id, 'someone-else', 'wamid.x', new Date()), false);
  assert.equal(await recordFailed(prisma, id, 'someone-else', 'no', null), false);
  assert.equal(await recordAccepted(prisma, id, 'mine', 'wamid.1', new Date()), true);
  assert.equal(await recordAccepted(prisma, id, 'mine', 'wamid.2', new Date()), false, 'a second acceptance must not overwrite the first');
  assert.equal(await recordFailed(prisma, id, 'mine', 'late', null), false, 'a SENT recipient cannot later be failed');
  const [r] = await rows(s);
  assert.equal(r!.status, 'SENT'); assert.equal(r!.whatsappMessageId, 'wamid.1');
});

test('stale claims are closed as "delivery unknown" once, young claims are left alone', { skip }, async () => {
  const s = await seed(3); const [a, b, c] = s.recipientIds as [string, string, string];
  const t0 = new Date('2026-11-05T12:00:00Z');
  await claimRecipient(prisma, a, s.campaignId, 'ta', new Date(t0.getTime() - CLAIM_LEASE_MS - 1000)); // old
  await claimRecipient(prisma, b, s.campaignId, 'tb', new Date(t0.getTime() - 5000));                    // young: its worker may be mid-send
  // c was never claimed
  assert.equal(await closeStaleClaims(prisma, s.campaignId, s.recipientIds, t0), 1);
  assert.equal(await closeStaleClaims(prisma, s.campaignId, s.recipientIds, t0), 0, 'idempotent');
  const byId = Object.fromEntries((await rows(s)).map((r) => [r.id, r]));
  assert.equal(byId[a]!.status, 'FAILED'); assert.equal(byId[a]!.errorMessage, UNKNOWN_DELIVERY_REASON);
  assert.equal(byId[b]!.status, 'PENDING'); assert.equal(byId[c]!.status, 'PENDING');
  assert.equal((await prisma.campaign.findUniqueOrThrow({ where: { id: s.campaignId } })).failedCount, 1);
});

// ---------------------------------------------------------------------------------------------------------------- the processor
test('a normal batch sends each recipient once, records the message and completes the campaign', { skip }, async () => {
  const s = await seed(4); const meta = stubMeta(async (_u, b) => accept(b.to));
  try {
    await worker().process(job(s));
    assert.deepEqual([...meta.calls].sort(), [...s.phones].sort());
    const rs = await rows(s);
    assert.ok(rs.every((r) => r.status === 'SENT' && r.messageId && r.whatsappMessageId && r.claimToken));
    assert.equal(await prisma.message.count({ where: { tenantId: s.tenantId } }), 4);
    const c = await prisma.campaign.findUniqueOrThrow({ where: { id: s.campaignId } });
    assert.equal(c.sentCount, 4); assert.equal(c.failedCount, 0); assert.equal(c.status, 'COMPLETED');
  } finally { meta.restore(); }
});

test('re-running a finished batch (a retried or duplicated job) sends nothing', { skip }, async () => {
  const s = await seed(3); const meta = stubMeta(async (_u, b) => accept(b.to));
  try {
    await worker().process(job(s));
    const before = meta.calls.length;
    await worker().process(job(s)); await worker().process(job(s));
    assert.equal(meta.calls.length, before);
    assert.equal((await prisma.campaign.findUniqueOrThrow({ where: { id: s.campaignId } })).sentCount, 3, 'counters are not inflated by reruns');
  } finally { meta.restore(); }
});

test('two workers on the same batch at the same time send each recipient exactly once', { skip }, async () => {
  const s = await seed(8); const meta = stubMeta(async (_u, b) => { await sleep(15); return accept(b.to); });
  try {
    await Promise.all([worker().process(job(s)), worker().process(job(s)), worker().process(job(s))]);
    const perPhone = new Map<string, number>(); for (const p of meta.calls) perPhone.set(p, (perPhone.get(p) ?? 0) + 1);
    assert.equal(perPhone.size, 8, 'every recipient was sent');
    assert.ok([...perPhone.values()].every((n) => n === 1), `duplicate sends: ${JSON.stringify([...perPhone])}`);
    assert.equal((await prisma.campaign.findUniqueOrThrow({ where: { id: s.campaignId } })).sentCount, 8);
    assert.equal(await prisma.message.count({ where: { tenantId: s.tenantId } }), 8);
  } finally { meta.restore(); }
});

test('CRASH WINDOW 1: the worker dies while the call to Meta is in flight; the retry does not resend that recipient', { skip }, async () => {
  const s = await seed(3);
  const hang = new Promise<never>(() => undefined);
  const meta = stubMeta(async (_u, b) => (b.to === s.phones[0] ? hang : accept(b.to)));
  try {
    void worker().process(job(s)); // dies mid-send of recipient 0: never settles, never records
    // wait for the call to Meta itself to be in flight (the claim is written just before it)
    await waitFor(() => meta.calls.includes(s.phones[0]!));
    assert.ok((await rows(s)).some((r) => r.claimedAt));
    // the job is retried after the lease: nothing may be sent to recipient 0 again
    const later = () => new Date(Date.now() + CLAIM_LEASE_MS + 5000);
    await worker(later).process(job(s));
    assert.equal(meta.calls.filter((p) => p === s.phones[0]).length, 1, 'recipient 0 must not be sent a second time');
    const byPhone = Object.fromEntries((await Promise.all(s.recipientIds.map(async (id, i) => [s.phones[i]!, await prisma.campaignRecipient.findUniqueOrThrow({ where: { id } })] as const))));
    assert.equal(byPhone[s.phones[0]!]!.status, 'FAILED'); assert.equal(byPhone[s.phones[0]!]!.errorMessage, UNKNOWN_DELIVERY_REASON);
    assert.equal(byPhone[s.phones[1]!]!.status, 'SENT'); assert.equal(byPhone[s.phones[2]!]!.status, 'SENT');
    const c = await prisma.campaign.findUniqueOrThrow({ where: { id: s.campaignId } });
    assert.equal(c.status, 'COMPLETED', 'the campaign still settles'); assert.equal(c.failedCount, 1); assert.equal(c.sentCount, 2);
  } finally { meta.restore(); }
});

test('a retry BEFORE the lease expires leaves an in-flight recipient alone (its worker may still be sending)', { skip }, async () => {
  const s = await seed(2); const hang = new Promise<never>(() => undefined);
  const meta = stubMeta(async (_u, b) => (b.to === s.phones[0] ? hang : accept(b.to)));
  try {
    void worker().process(job(s));
    // wait for the call to Meta itself to be in flight (the claim is written just before it)
    await waitFor(() => meta.calls.includes(s.phones[0]!));
    assert.ok((await rows(s)).some((r) => r.claimedAt));
    await worker().process(job(s)); // immediately, same clock
    assert.equal(meta.calls.filter((p) => p === s.phones[0]).length, 1);
    const first = await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: s.recipientIds[0]! } });
    assert.equal(first.status, 'PENDING', 'still undecided, not failed');
  } finally { meta.restore(); }
});

test('CRASH WINDOW 2: Meta accepted the message but the outcome could not be written; the retry still does not resend', { skip }, async () => {
  const s = await seed(2); const meta = stubMeta(async (_u, b) => accept(b.to));
  // Fail every write that would record acceptance, as a database outage at that exact moment would.
  const flaky = new Proxy(prisma, { get(t, p, r) {
    if (p === 'campaignRecipient') return new Proxy(t.campaignRecipient, { get(ct, cp, cr) {
      if (cp === 'updateMany') return (args: { data?: { status?: string } }) => (args.data?.status === 'SENT' ? Promise.reject(new Error('database unavailable')) : (ct.updateMany as (a: unknown) => unknown)(args));
      return Reflect.get(ct, cp, cr);
    } });
    return Reflect.get(t, p, r);
  } }) as PrismaClient;
  try {
    await assert.rejects(new CampaignSendWorker(flaky, CONN, () => new Date(), 0).process(job(s)), /database unavailable/);
    assert.equal(meta.calls.length, 1, 'the first recipient was sent, then the job failed');
    const sentOnce = meta.calls.length;
    await worker().process(job(s)); // retry straight away: claim still held
    assert.equal(meta.calls.filter((p) => p === s.phones[0]).length, 1, 'no duplicate to the recipient Meta already accepted');
    await worker(() => new Date(Date.now() + CLAIM_LEASE_MS + 5000)).process(job(s));
    assert.equal(meta.calls.filter((p) => p === s.phones[0]).length, 1);
    assert.ok(meta.calls.length >= sentOnce);
    const first = await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: s.recipientIds[0]! } });
    // The unavoidable boundary: Meta accepted it and we could not write that down, so it is reported as failed-unknown, never resent.
    assert.equal(first.status, 'FAILED'); assert.equal(first.errorMessage, UNKNOWN_DELIVERY_REASON);
  } finally { meta.restore(); }
});

test('CRASH WINDOW 3: accepted and recorded, but the inbox record is missing; the next run links it and sends nothing', { skip }, async () => {
  const s = await seed(2); const meta = stubMeta(async (_u, b) => accept(b.to));
  let failMessageCreate = true;
  const flaky = new Proxy(prisma, { get(t, p, r) {
    if (p === 'message') return new Proxy(t.message, { get(mt, mp, mr) {
      if (mp === 'create') return (args: unknown) => (failMessageCreate ? Promise.reject(new Error('message table unavailable')) : (mt.create as (a: unknown) => unknown)(args));
      return Reflect.get(mt, mp, mr);
    } });
    return Reflect.get(t, p, r);
  } }) as PrismaClient;
  try {
    await new CampaignSendWorker(flaky, CONN, () => new Date(), 0).process(job(s));
    let rs = await rows(s);
    assert.ok(rs.every((r) => r.status === 'SENT' && r.whatsappMessageId && !r.messageId), 'sent and remembered, not yet linked');
    assert.equal(await prisma.message.count({ where: { tenantId: s.tenantId } }), 0);
    const sent = meta.calls.length;
    failMessageCreate = false;
    await new CampaignSendWorker(flaky, CONN, () => new Date(), 0).process(job(s));
    assert.equal(meta.calls.length, sent, 'repairing the record sends nothing');
    rs = await rows(s);
    assert.ok(rs.every((r) => r.messageId), 'now linked');
    assert.equal(await prisma.message.count({ where: { tenantId: s.tenantId } }), 2);
    assert.deepEqual((await prisma.message.findMany({ where: { tenantId: s.tenantId } })).map((m) => m.whatsappMessageId).sort(), s.phones.map((p) => `wamid.${p}`).sort());
    assert.equal((await prisma.campaign.findUniqueOrThrow({ where: { id: s.campaignId } })).sentCount, 2, 'counted once');
  } finally { meta.restore(); }
});

test('a definite refusal (4xx) fails the recipient with Meta\'s reason and is never retried', { skip }, async () => {
  const s = await seed(2);
  const refusal = new AxiosError('Request failed with status code 400', 'ERR_BAD_REQUEST', undefined, undefined, { status: 400, data: { error: { code: 131026, message: 'Message undeliverable' } } } as never);
  const meta = stubMeta(async (_u, b) => { if (b.to === s.phones[0]) throw refusal; return accept(b.to); });
  try {
    await worker().process(job(s)); await worker(() => new Date(Date.now() + CLAIM_LEASE_MS + 5000)).process(job(s));
    assert.equal(meta.calls.filter((p) => p === s.phones[0]).length, 1);
    const r = await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: s.recipientIds[0]! } });
    assert.equal(r.status, 'FAILED'); assert.equal(r.errorCode, 131026); assert.ok(!/not confirmed/i.test(r.errorMessage ?? ''));
  } finally { meta.restore(); }
});

test('no answer at all (timeout) or a 5xx is closed as failed but says delivery was not confirmed, and is not resent', { skip }, async () => {
  const s = await seed(2);
  const timeout = new AxiosError('timeout of 15000ms exceeded', 'ECONNABORTED');
  const gateway = new AxiosError('Request failed with status code 502', 'ERR_BAD_RESPONSE', undefined, undefined, { status: 502, data: {} } as never);
  const meta = stubMeta(async (_u, b) => { throw b.to === s.phones[0] ? timeout : gateway; });
  try {
    await worker().process(job(s)); await worker().process(job(s));
    assert.equal(meta.calls.length, 2, 'each recipient was attempted exactly once');
    for (const r of await rows(s)) { assert.equal(r.status, 'FAILED'); assert.match(r.errorMessage ?? '', /Delivery not confirmed/); }
  } finally { meta.restore(); }
});

test('opted-out and blocked contacts are never sent to, and never reach Meta', { skip }, async () => {
  const s = await seed(3, { optedOutIndex: 1 }); const meta = stubMeta(async (_u, b) => accept(b.to));
  try {
    await worker().process(job(s));
    assert.ok(!meta.calls.includes(s.phones[1]!));
    const r = await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: s.recipientIds[1]! } });
    assert.equal(r.status, 'FAILED'); assert.match(r.errorMessage ?? '', /opted out/);
  } finally { meta.restore(); }
});

test('a campaign that is paused sends nothing and claims nothing', { skip }, async () => {
  const s = await seed(2); const meta = stubMeta(async (_u, b) => accept(b.to));
  try {
    await prisma.campaign.update({ where: { id: s.campaignId }, data: { status: 'PAUSED' } });
    await worker().process(job(s));
    assert.equal(meta.calls.length, 0);
    assert.ok((await rows(s)).every((r) => r.status === 'PENDING' && !r.claimedAt));
  } finally { meta.restore(); }
});
