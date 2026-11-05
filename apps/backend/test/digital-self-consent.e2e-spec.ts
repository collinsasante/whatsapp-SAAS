import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { UserRole } from '@whatsapp-platform/shared-types';
import { createTestingApp, signTestToken } from './utils/test-app';
import { testPrisma, resetTestDatabase, createTenantWithUser, disconnectTestDatabase } from './utils/test-db';
import { currentDisclosureVersion } from '../src/ai-learning/learning-disclosure';
import { DigitalSelfLearningService } from '../src/digital-self/digital-self-learning.service';
import { provisionDigitalSelf } from '../src/digital-self/digital-self.service';
import { DigitalSelfContextService } from '../src/digital-self/digital-self-context.service';
import { DIGITAL_SELF_CONSENT_VERSION } from '../src/digital-self/digital-self-consent.util';

/**
 * Individual Digital Self consent on the real HTTP stack and a real database: what an agent can decide, what an admin cannot, and that learning,
 * use of the profile and assignment all stop the moment the agent says no. Nothing here calls a provider.
 */
describe('Digital Self: the agent\'s own consent (e2e)', () => {
  let app: INestApplication;
  const V = DIGITAL_SELF_CONSENT_VERSION;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => { app = await createTestingApp({ validation: true }); });
  afterAll(async () => { await app.close(); await disconnectTestDatabase(); });
  beforeEach(async () => { await resetTestDatabase(); });

  type U = { id: string; email: string; tenantId: string; role: UserRole };
  const auth = (u: U) => ({ Authorization: `Bearer ${signTestToken(app, { sub: u.id, email: u.email, tenantId: u.tenantId, role: u.role })}` });

  async function addUser(tenantId: string, role: UserRole, name: string): Promise<U> {
    const u = await testPrisma.user.create({ data: { tenantId, name, email: `${name}-${randomUUID().slice(0, 6)}@example.com`, passwordHash: 'not-a-real-hash', role, isActive: true } });
    return { id: u.id, email: u.email, tenantId, role };
  }

  /** A workspace where Digital Self is switched on and its administrator has acknowledged the disclosure (the workspace-level opt-in). */
  async function workspace(opts: { available?: boolean } = {}) {
    const { tenant, user } = await createTenantWithUser({ role: UserRole.ADMIN });
    const admin: U = { id: user.id, email: user.email, tenantId: tenant.id, role: UserRole.ADMIN };
    const available = opts.available !== false;
    if (available) {
      await testPrisma.featureFlag.upsert({ where: { key: 'digital_self' }, update: { enabled: true, rolloutType: 'all' }, create: { key: 'digital_self', name: 'Digital Self', enabled: true, rolloutType: 'all' } });
      await testPrisma.aiLearningSettings.create({ data: { tenantId: tenant.id, learningEnabled: true, learningPaused: false, disclosureVersion: currentDisclosureVersion(), disclosureAcknowledgedAt: new Date(), disclosureAcknowledgedById: admin.id } });
    }
    const ama = await addUser(tenant.id, UserRole.AGENT, 'ama');
    const kofi = await addUser(tenant.id, UserRole.AGENT, 'kofi');
    const viewer = await addUser(tenant.id, UserRole.VIEWER, 'vera');
    return { tenantId: tenant.id, admin, ama, kofi, viewer };
  }

  const me = (u: U) => api().get('/digital-self/me').set(auth(u));
  const decide = (u: U, body: Record<string, unknown>) => api().put('/digital-self/me/consent').set(auth(u)).send(body);
  const accept = (u: U) => decide(u, { decision: 'ACCEPT', version: V });
  // Digital Selves are created lazily (first list, first learning, first visit), exactly as in production; the helper provisions like they do.
  const selfOf = async (userId: string) => {
    const u = await testPrisma.user.findUniqueOrThrow({ where: { id: userId } });
    await provisionDigitalSelf(testPrisma as never, u.tenantId, userId);
    return testPrisma.digitalSelf.findFirstOrThrow({ where: { userId } });
  };
  const events = (selfId: string) => testPrisma.digitalSelfLearningEvent.count({ where: { digitalSelfId: selfId } });

  async function conversation(tenantId: string, assignedToId?: string, digitalSelfId?: string) {
    const contact = await testPrisma.contact.create({ data: { tenantId, phone: `+23355${Math.floor(1e6 + Math.random() * 9e6)}`, name: 'Customer' } });
    return testPrisma.conversation.create({ data: { tenantId, contactId: contact.id, assignedToId, digitalSelfId } });
  }
  const REPLIES = ['Hello! Happy to help. Which size do you need?', 'Thanks for waiting. The red one is available today.', 'Hi there, delivery to Accra is GHS 20. Shall I book it?'];
  async function reply(u: U, conversationId: string, i: number) {
    const conv = await testPrisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    return testPrisma.message.create({ data: { tenantId: u.tenantId, conversationId, contactId: conv.contactId, senderId: u.id, direction: 'OUTBOUND', type: 'TEXT', content: `${REPLIES[i % REPLIES.length]} (${i})` } });
  }
  async function learnN(u: U, conversationId: string, n: number) {
    const learning = app.get(DigitalSelfLearningService);
    const outcomes: string[] = [];
    for (let i = 0; i < n; i++) outcomes.push(await learning.learnFromMessage(u.tenantId, (await reply(u, conversationId, i)).id));
    return outcomes;
  }

  describe('when the prompt appears', () => {
    it('never before there is something to agree to: not when the feature is off for the workspace, nor when the workspace has not opted in', async () => {
      const w = await workspace({ available: false });
      const res = await me(w.ama).expect(200);
      expect(res.body).toMatchObject({ eligible: true, workspaceAvailable: false, promptRequired: false, consent: { status: 'PENDING' } });
    });

    it('appears once the workspace has made it available and the agent has not decided, and carries the wording version to agree to', async () => {
      const w = await workspace();
      const res = await me(w.ama).expect(200);
      expect(res.body).toMatchObject({ eligible: true, workspaceAvailable: true, promptRequired: true, consentVersion: V, consent: { status: 'PENDING', need: 'decide' } });
      expect(res.body.learned.summary).toBeNull();
    });

    it('is not shown to a role that has no Digital Self (a viewer), who is refused outright', async () => {
      const w = await workspace();
      await me(w.viewer).expect(403);
    });

    it('is never shown again after a decision, whichever it was', async () => {
      const w = await workspace();
      await accept(w.ama).expect(200);
      expect((await me(w.ama)).body.promptRequired).toBe(false);
      await decide(w.kofi, { decision: 'DECLINE' }).expect(200);
      expect((await me(w.kofi)).body.promptRequired).toBe(false);
    });

    it('comes back when the wording changes (an agreement to older wording stops counting)', async () => {
      const w = await workspace();
      await accept(w.ama).expect(200);
      const self = await selfOf(w.ama.id);
      await testPrisma.$executeRaw`UPDATE digital_selves SET consent_version = 'ds-consent-v0' WHERE id = ${self.id}`;
      const res = await me(w.ama).expect(200);
      expect(res.body).toMatchObject({ promptRequired: true, consent: { status: 'GRANTED', need: 'reconfirm' } });
      expect(res.body.learned.summary).toBeNull(); // not used until they re-confirm
    });
  });

  describe('accepting, declining and withdrawing', () => {
    it('accepting records the agent\'s own decision against them and their workspace, at the current wording, and audits it', async () => {
      const w = await workspace();
      const res = await accept(w.ama).expect(200);
      expect(res.body).toMatchObject({ consent: { status: 'GRANTED', need: 'none' }, promptRequired: false, changed: true });
      const self = await selfOf(w.ama.id);
      expect(self).toMatchObject({ tenantId: w.tenantId, userId: w.ama.id, consentStatus: 'GRANTED', consentVersion: V, consentDecidedById: w.ama.id });
      expect(self.consentDecidedAt).not.toBeNull();
      const audit = await testPrisma.auditLog.findMany({ where: { tenantId: w.tenantId, resource: 'digital_self_consent' } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ userId: w.ama.id });
    });

    it('accepting twice is harmless: no second audit entry, the original time is kept', async () => {
      const w = await workspace();
      await accept(w.ama).expect(200);
      const first = (await selfOf(w.ama.id)).consentDecidedAt;
      const again = await accept(w.ama).expect(200);
      expect(again.body.changed).toBe(false);
      expect((await selfOf(w.ama.id)).consentDecidedAt).toEqual(first);
      expect(await testPrisma.auditLog.count({ where: { resource: 'digital_self_consent' } })).toBe(1);
    });

    it('accepting wording the agent was not shown is refused: a missing or stale version changes nothing', async () => {
      const w = await workspace();
      await decide(w.ama, { decision: 'ACCEPT' }).expect(409);
      await decide(w.ama, { decision: 'ACCEPT', version: 'ds-consent-v0' }).expect(409);
      expect((await selfOf(w.ama.id)).consentStatus).toBe('PENDING');
    });

    it('declining records DECLINED, learns nothing from that agent afterwards, and can be changed later', async () => {
      const w = await workspace();
      const conv = await conversation(w.tenantId, w.ama.id);
      await decide(w.ama, { decision: 'DECLINE' }).expect(200);
      expect(await learnN(w.ama, conv.id, 3)).toEqual(['no_consent', 'no_consent', 'no_consent']);
      expect(await events((await selfOf(w.ama.id)).id)).toBe(0);
      await accept(w.ama).expect(200);
      expect(await learnN(w.ama, conv.id, 1)).toEqual(['learned']);
    });

    it('declining after having agreed is not a thing: the answer is to withdraw', async () => {
      const w = await workspace();
      await accept(w.ama).expect(200);
      await decide(w.ama, { decision: 'DECLINE' }).expect(400);
      expect((await selfOf(w.ama.id)).consentStatus).toBe('GRANTED');
    });

    it('withdrawing with nothing agreed to is refused', async () => {
      const w = await workspace();
      await decide(w.ama, { decision: 'WITHDRAW' }).expect(400);
    });

    it('rejects an unknown decision and unknown fields (nothing can smuggle in another person\'s id)', async () => {
      const w = await workspace();
      await decide(w.ama, { decision: 'MAYBE' }).expect(400);
      await decide(w.ama, { decision: 'ACCEPT', version: V, userId: w.kofi.id }).expect(400);
      await decide(w.ama, { decision: 'ACCEPT', version: V, digitalSelfId: randomUUID() }).expect(400);
      expect((await selfOf(w.kofi.id)).consentStatus).toBe('PENDING');
    });
  });

  describe('withdrawal stops everything at once and keeps what was learned unless deletion is asked for', () => {
    it('learning stops on the very next reply, the stored profile is kept, and a job queued before the withdrawal learns nothing', async () => {
      const w = await workspace();
      const conv = await conversation(w.tenantId, w.ama.id);
      await accept(w.ama).expect(200);
      expect(await learnN(w.ama, conv.id, 12)).toEqual(Array(12).fill('learned'));
      const self = await selfOf(w.ama.id);
      expect(self.evidenceCount).toBe(12);

      const queued = await reply(w.ama, conv.id, 100); // a reply already waiting for the learning worker
      await decide(w.ama, { decision: 'WITHDRAW' }).expect(200);

      expect(await app.get(DigitalSelfLearningService).learnFromMessage(w.tenantId, queued.id)).toBe('no_consent');
      expect(await learnN(w.ama, conv.id, 3)).toEqual(['no_consent', 'no_consent', 'no_consent']);
      const after = await selfOf(w.ama.id);
      expect(after.consentStatus).toBe('WITHDRAWN');
      expect(after.evidenceCount).toBe(12);          // nothing new
      expect(await events(self.id)).toBe(12);        // nothing removed: only the agent can ask for that
      expect(after.profile).toEqual(self.profile);
    });

    it('the AI stops using the profile on the next reply, on a conversation assigned to it and on one the agent owns', async () => {
      const w = await workspace();
      const learningConv = await conversation(w.tenantId, w.ama.id);
      await accept(w.ama).expect(200);
      await learnN(w.ama, learningConv.id, 12);
      const self = await selfOf(w.ama.id);
      const assigned = await conversation(w.tenantId, undefined, self.id);
      const owned = await conversation(w.tenantId, w.ama.id);
      const ctx = app.get(DigitalSelfContextService);

      expect(await ctx.getStyleBlock(w.tenantId, assigned.id)).not.toBe('');
      expect(await ctx.getStyleBlock(w.tenantId, owned.id)).not.toBe('');

      await decide(w.ama, { decision: 'WITHDRAW' }).expect(200);

      expect(await ctx.getStyleBlock(w.tenantId, assigned.id)).toBe('');
      expect(await ctx.getStyleBlock(w.tenantId, owned.id)).toBe('');
      expect(await ctx.getStyleBlockFor(w.tenantId, self.id)).toBe('');
    });

    it('withdrawing with a deletion request also erases what was learned, and leaves the withdrawal in place', async () => {
      const w = await workspace();
      const conv = await conversation(w.tenantId, w.ama.id);
      await accept(w.ama).expect(200);
      await learnN(w.ama, conv.id, 5);
      const res = await decide(w.ama, { decision: 'WITHDRAW', deleteData: true }).expect(200);
      expect(res.body).toMatchObject({ evidenceRemoved: 5, consent: { status: 'WITHDRAWN' } });
      const self = await selfOf(w.ama.id);
      expect(self).toMatchObject({ evidenceCount: 0, consentStatus: 'WITHDRAWN' });
      expect(self.lastLearnedAt).toBeNull();
      expect((self.profile as { samples?: number }).samples ?? 0).toBe(0);
      expect(await events(self.id)).toBe(0);
    });
  });

  describe('deletion requests', () => {
    it('erase the agent\'s own learned data and profile only, never anyone else\'s, and do not change the consent decision', async () => {
      const w = await workspace();
      await accept(w.ama).expect(200);
      await accept(w.kofi).expect(200);
      const amaConv = await conversation(w.tenantId, w.ama.id);
      const kofiConv = await conversation(w.tenantId, w.kofi.id);
      await learnN(w.ama, amaConv.id, 4);
      await learnN(w.kofi, kofiConv.id, 6);

      const res = await api().delete('/digital-self/me/data').set(auth(w.ama)).expect(200);
      expect(res.body.evidenceRemoved).toBe(4);
      const ama = await selfOf(w.ama.id); const kofi = await selfOf(w.kofi.id);
      expect(ama).toMatchObject({ evidenceCount: 0, consentStatus: 'GRANTED' });
      expect(await events(ama.id)).toBe(0);
      expect(kofi.evidenceCount).toBe(6);
      expect(await events(kofi.id)).toBe(6);
    });

    it('an admin cannot use the deletion route to erase an agent: it only ever acts on the caller', async () => {
      const w = await workspace();
      await accept(w.ama).expect(200);
      await learnN(w.ama, (await conversation(w.tenantId, w.ama.id)).id, 3);
      await api().delete('/digital-self/me/data').set(auth(w.admin)).expect(200); // erases the ADMIN\'s own (empty) data
      await api().delete(`/digital-self/${(await selfOf(w.ama.id)).id}/data`).set(auth(w.admin)).expect(404);
      expect((await selfOf(w.ama.id)).evidenceCount).toBe(3);
    });
  });

  describe('independence and the limits of an administrator', () => {
    it('one agent\'s consent never authorises another: only the agent who agreed is learned from or styled', async () => {
      const w = await workspace();
      const conv = await conversation(w.tenantId);
      await accept(w.ama).expect(200);
      expect(await learnN(w.ama, conv.id, 2)).toEqual(['learned', 'learned']);
      expect(await learnN(w.kofi, conv.id, 2)).toEqual(['no_consent', 'no_consent']);
      expect((await selfOf(w.kofi.id)).evidenceCount).toBe(0);
      // and a withdrawal by one leaves the other untouched
      await accept(w.kofi).expect(200);
      await decide(w.ama, { decision: 'WITHDRAW' }).expect(200);
      expect(await learnN(w.kofi, conv.id, 1)).toEqual(['learned']);
    });

    it('an admin deciding through the same route decides only for themselves; the agents stay as they were', async () => {
      const w = await workspace();
      await accept(w.admin).expect(200);
      expect((await selfOf(w.admin.id)).consentStatus).toBe('GRANTED');
      expect((await selfOf(w.ama.id)).consentStatus).toBe('PENDING');
      expect((await selfOf(w.kofi.id)).consentStatus).toBe('PENDING');
    });

    it('there is no route to consent for someone else, and the admin routes that exist cannot grant consent', async () => {
      const w = await workspace();
      const amaSelf = await selfOf(w.ama.id);
      await api().put(`/digital-self/${amaSelf.id}/consent`).set(auth(w.admin)).send({ decision: 'ACCEPT', version: V }).expect(404);
      await api().patch(`/digital-self/${amaSelf.id}/enabled`).set(auth(w.admin)).send({ enabled: true }).expect(200);
      await api().patch(`/digital-self/${amaSelf.id}/learning`).set(auth(w.admin)).send({ paused: false }).expect(200);
      expect((await selfOf(w.ama.id)).consentStatus).toBe('PENDING');
      expect(await learnN(w.ama, (await conversation(w.tenantId)).id, 1)).toEqual(['no_consent']);
    });

    it('the database itself refuses a consent decision recorded by anyone but the agent', async () => {
      const w = await workspace();
      const amaSelf = await selfOf(w.ama.id);
      await expect(testPrisma.$executeRaw`UPDATE digital_selves SET consent_status = 'GRANTED', consent_version = ${V}, consent_decided_by_id = ${w.admin.id} WHERE id = ${amaSelf.id}`).rejects.toThrow(/digital_selves_consent_by_self_chk/);
      await expect(testPrisma.$executeRaw`UPDATE digital_selves SET consent_status = 'GRANTED', consent_version = ${V}, consent_decided_by_id = NULL WHERE id = ${amaSelf.id}`).rejects.toThrow(/digital_selves_consent_by_self_chk/);
      expect((await selfOf(w.ama.id)).consentStatus).toBe('PENDING');
    });

    it('an admin sees each agent\'s consent status but not what was learned about an agent who has not agreed, and cannot assign their profile', async () => {
      const w = await workspace();
      const conv = await conversation(w.tenantId, w.ama.id);
      await accept(w.ama).expect(200);
      await learnN(w.ama, conv.id, 12);
      await decide(w.ama, { decision: 'WITHDRAW' }).expect(200);
      const list = (await api().get('/digital-self').set(auth(w.admin)).expect(200)).body.items as Array<{ userId: string; consent: { status: string }; summary: { hasLearnedTraits: boolean }; assignable: boolean; evidenceCount: number }>;
      const row = list.find((i) => i.userId === w.ama.id)!;
      expect(row.consent.status).toBe('WITHDRAWN');
      expect(row.summary.hasLearnedTraits).toBe(false);
      expect(row.assignable).toBe(false);
      expect(row.evidenceCount).toBe(12);
      const target = await conversation(w.tenantId);
      await api().put(`/digital-self/conversations/${target.id}`).set(auth(w.admin)).send({ digitalSelfId: (await selfOf(w.ama.id)).id }).expect(400);
    });

    it('assignment works again once the agent agrees', async () => {
      const w = await workspace();
      const target = await conversation(w.tenantId);
      const amaSelf = await selfOf(w.ama.id);
      await api().put(`/digital-self/conversations/${target.id}`).set(auth(w.admin)).send({ digitalSelfId: amaSelf.id }).expect(400);
      await accept(w.ama).expect(200);
      await api().put(`/digital-self/conversations/${target.id}`).set(auth(w.admin)).send({ digitalSelfId: amaSelf.id }).expect(200);
    });
  });

  describe('what does not count as consent', () => {
    it('a fully opted-in workspace (administrator acknowledged, feature on) does not stand in for the agent', async () => {
      const w = await workspace();
      expect(await learnN(w.ama, (await conversation(w.tenantId)).id, 2)).toEqual(['no_consent', 'no_consent']);
    });

    it('every Digital Self starts pending, and one created before this feature existed is pending too', async () => {
      const w = await workspace();
      expect((await me(w.ama)).body.consent.status).toBe('PENDING');
      const existing = await selfOf(w.ama.id);
      expect(existing).toMatchObject({ consentStatus: 'PENDING', consentVersion: null, consentDecidedAt: null, consentDecidedById: null });
    });

    it('a record that says GRANTED for older wording is not accepted as agreement to the current wording', async () => {
      const w = await workspace();
      const self = await selfOf(w.ama.id);
      await testPrisma.$executeRaw`UPDATE digital_selves SET consent_status = 'GRANTED', consent_version = 'ds-consent-v0', consent_decided_by_id = ${w.ama.id} WHERE id = ${self.id}`;
      expect(await learnN(w.ama, (await conversation(w.tenantId)).id, 1)).toEqual(['no_consent']);
    });
  });

  describe('who may call what, and tenants', () => {
    it('refuses a viewer on every self-service route and an unauthenticated caller everywhere', async () => {
      const w = await workspace();
      await decide(w.viewer, { decision: 'ACCEPT', version: V }).expect(403);
      await api().delete('/digital-self/me/data').set(auth(w.viewer)).expect(403);
      await api().get('/digital-self/me').expect(401);
      await api().put('/digital-self/me/consent').send({ decision: 'ACCEPT', version: V }).expect(401);
      await api().delete('/digital-self/me/data').expect(401);
    });

    it('an agent still cannot use the admin controls', async () => {
      const w = await workspace();
      const kofiSelf = await selfOf(w.kofi.id);
      await api().patch(`/digital-self/${kofiSelf.id}/learning`).set(auth(w.ama)).send({ paused: true }).expect(403);
      await api().post(`/digital-self/${kofiSelf.id}/reset`).set(auth(w.ama)).expect(403);
    });

    it('a decision in one workspace never touches another workspace\'s agents', async () => {
      const a = await workspace();
      const b = await workspace();
      await accept(b.ama).expect(200);
      expect((await selfOf(b.ama.id)).consentStatus).toBe('GRANTED');
      expect((await selfOf(a.ama.id)).consentStatus).toBe('PENDING');
      expect(await learnN(a.ama, (await conversation(a.tenantId)).id, 1)).toEqual(['no_consent']);
    });
  });
});
