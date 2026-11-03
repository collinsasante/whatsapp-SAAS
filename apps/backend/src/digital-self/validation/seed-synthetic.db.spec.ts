/**
 * Readiness acceptance against a real PostgreSQL, driven through the staging seeder and the real settings service: new workspaces stay
 * opted out, missing configuration fails safe, the disclosure acknowledgement is required, an outdated one blocks learning, a synthetic
 * workspace can opt in explicitly, pausing learning leaves Digital Self itself running, and customer AI credits are never touched.
 */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { optInSyntheticWorkspace, seedSynthetic } from './seed-synthetic';
import { AMA } from './synthetic-personas';
import { DigitalSelfLearningService } from '../digital-self-learning.service';
import { DigitalSelfContextService } from '../digital-self-context.service';
import { AiLearningSettingsService } from '../../ai-learning/learning-settings.service';
import { AiLearningCostService } from '../../ai-learning/learning-cost.service';
import { currentDisclosureVersion } from '../../ai-learning/learning-disclosure';
import { dbSuite, makeFixtures, newTestClient } from '../../ai-learning/testing/db-test-env';

const prisma = newTestClient();
const fx = prisma ? makeFixtures(prisma) : (undefined as unknown as ReturnType<typeof makeFixtures>);

dbSuite('Staging seeder and the learning opt-in (real PostgreSQL)', () => {
  const settings = prisma ? new AiLearningSettingsService(prisma as never, new AiLearningCostService(prisma as never)) : (undefined as unknown as AiLearningSettingsService);
  const learner = prisma ? new DigitalSelfLearningService(prisma as never) : (undefined as unknown as DigitalSelfLearningService);
  const context = prisma ? new DigitalSelfContextService(prisma as never, { isEnabledCached: async () => true } as never) : (undefined as unknown as DigitalSelfContextService);
  const ENV = ['AI_LEARNING_OPT_IN_OPEN', 'AI_LEARNING_RETENTION_ENABLED'];
  afterEach(() => { for (const k of ENV) delete process.env[k]; });
  afterAll(async () => { await fx.cleanup(); await prisma.$disconnect(); });
  const open = () => { process.env['AI_LEARNING_OPT_IN_OPEN'] = 'true'; };

  async function synthetic(name = 'synthetic-readiness') {
    const tenantId = await fx.tenant(name);
    const admin = await fx.user(tenantId, 'admin');
    return { tenantId, adminId: admin.id };
  }
  const evidence = (tenantId: string) => prisma.digitalSelfLearningEvent.count({ where: { tenantId } });

  describe('new workspaces stay opted out, and the seeder refuses them', () => {
    it('a fresh workspace has no settings row and learning is not active', async () => {
      const { tenantId } = await synthetic();
      expect(await prisma.aiLearningSettings.count({ where: { tenantId } })).toBe(0);
      await expect(settings.get(tenantId)).resolves.toMatchObject({ learningEnabled: false, learningActive: false, blockedReason: 'not_enabled' });
    });

    it('seeding a workspace that has not opted in is refused, says how to opt in, and writes nothing', async () => {
      const { tenantId, adminId } = await synthetic();
      await expect(seedSynthetic(prisma, tenantId, [{ userId: adminId, persona: AMA }], 3)).rejects.toThrow(/AI learning is not active for it \(not_enabled\).*--opt-in/s);
      expect(await prisma.conversation.count({ where: { tenantId } })).toBe(0);
      expect(await evidence(tenantId)).toBe(0);
    });

    it('opting one workspace in leaves every other workspace opted out', async () => {
      open();
      const a = await synthetic();
      const b = await synthetic();
      await optInSyntheticWorkspace(prisma, a.tenantId, a.adminId);
      await expect(settings.get(b.tenantId)).resolves.toMatchObject({ learningEnabled: false, learningActive: false });
    });
  });

  describe('missing or wrong configuration fails safe', () => {
    it.each([[undefined], [''], ['false'], ['TRUE'], ['1'], ['yes']])('with AI_LEARNING_OPT_IN_OPEN = %j the explicit opt-in is refused and nothing is written', async (value) => {
      if (value === undefined) delete process.env['AI_LEARNING_OPT_IN_OPEN']; else process.env['AI_LEARNING_OPT_IN_OPEN'] = value;
      const { tenantId, adminId } = await synthetic();
      await expect(optInSyntheticWorkspace(prisma, tenantId, adminId)).rejects.toBeInstanceOf(ForbiddenException);
      expect(await prisma.aiLearningSettings.count({ where: { tenantId } })).toBe(0);
      expect(await prisma.aiLearningAuditLog.count({ where: { tenantId } })).toBe(0);
    });

    it('a workspace whose name does not look synthetic can never be opted in by the seeder', async () => {
      open();
      const { tenantId, adminId } = await synthetic('Acme Prints');
      await expect(optInSyntheticWorkspace(prisma, tenantId, adminId)).rejects.toThrow(/Refusing to seed/);
      expect(await prisma.aiLearningSettings.count({ where: { tenantId } })).toBe(0);
    });

    it('only an active ADMINISTRATOR of that very workspace can be the acknowledging identity', async () => {
      open();
      const { tenantId } = await synthetic();
      const other = await synthetic();
      const agent = await prisma.user.create({ data: { tenantId, email: `agent-${fx.tag}@t.test`, name: 'agent', passwordHash: 'x', role: 'AGENT' } as never });
      await expect(optInSyntheticWorkspace(prisma, tenantId, agent.id)).rejects.toThrow(/not an active administrator/);
      await expect(optInSyntheticWorkspace(prisma, tenantId, other.adminId)).rejects.toThrow(/not an active administrator/);
      expect(await prisma.aiLearningSettings.count({ where: { tenantId } })).toBe(0);
    });
  });

  describe('the disclosure acknowledgement is required, and versioned', () => {
    it('the settings flow refuses to switch learning on without acknowledging the current notice', async () => {
      open();
      const { tenantId, adminId } = await synthetic();
      await expect(settings.update(tenantId, adminId, { learningEnabled: true })).rejects.toBeInstanceOf(ConflictException);
      await expect(settings.update(tenantId, adminId, { learningEnabled: true, acknowledgedDisclosureVersion: 'd1-stale' })).rejects.toMatchObject({ response: { code: 'DISCLOSURE_OUTDATED' } });
      expect(await settings.isLearningActive(tenantId)).toBe(false);
    });

    it('an explicit opt-in goes through the real rules and records the version, the administrator and the time', async () => {
      open();
      const { tenantId, adminId } = await synthetic();
      const view = await optInSyntheticWorkspace(prisma, tenantId, adminId);
      expect(view).toMatchObject({ learningEnabled: true, learningActive: true, blockedReason: null });
      const row = await prisma.aiLearningSettings.findUniqueOrThrow({ where: { tenantId } });
      expect(row).toMatchObject({ disclosureVersion: currentDisclosureVersion(), disclosureAcknowledgedById: adminId, enabledById: adminId });
      expect(row.disclosureAcknowledgedAt).toBeInstanceOf(Date);
    });

    it('an outdated acknowledgement stops seeding and evidence capture until the new notice is acknowledged', async () => {
      open();
      const { tenantId, adminId } = await synthetic();
      await optInSyntheticWorkspace(prisma, tenantId, adminId);
      expect(await seedSynthetic(prisma, tenantId, [{ userId: adminId, persona: AMA }], 3)).toMatchObject({ created: 3, learned: 3 });

      process.env['AI_LEARNING_RETENTION_ENABLED'] = 'true'; // changes the notice, so its version
      await expect(seedSynthetic(prisma, tenantId, [{ userId: adminId, persona: AMA }], 3)).rejects.toThrow(/\(disclosure_outdated\)/);
      const message = await prisma.message.findFirstOrThrow({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
      const before = await evidence(tenantId);
      expect(await learner.learnFromMessage(tenantId, message.id)).toBe('paused');
      expect(await evidence(tenantId)).toBe(before);

      await optInSyntheticWorkspace(prisma, tenantId, adminId); // acknowledges the NEW version
      expect(await seedSynthetic(prisma, tenantId, [{ userId: adminId, persona: AMA }], 2)).toMatchObject({ learned: 2 });
    });
  });

  describe('pausing learning does not disable Digital Self itself', () => {
    it('evidence capture stops, but the Digital Self stays enabled and READY and its style still applies; resuming restores learning', async () => {
      open();
      const { tenantId, adminId } = await synthetic();
      await optInSyntheticWorkspace(prisma, tenantId, adminId);
      expect(await seedSynthetic(prisma, tenantId, [{ userId: adminId, persona: AMA }], 36)).toMatchObject({ learned: 36 });
      const self = await prisma.digitalSelf.findFirstOrThrow({ where: { tenantId, userId: adminId } });
      expect(self).toMatchObject({ enabled: true, status: 'READY', evidenceCount: 36 });
      const styleBefore = await context.getStyleBlockFor(tenantId, self.id);
      expect(styleBefore).not.toBe('');

      await settings.update(tenantId, adminId, { learningPaused: true });

      const message = await prisma.message.findFirstOrThrow({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
      expect(await learner.learnFromMessage(tenantId, message.id)).toBe('paused'); // no more evidence while paused
      const paused = await prisma.digitalSelf.findUniqueOrThrow({ where: { id: self.id } });
      expect(paused).toMatchObject({ enabled: true, learningPaused: false, status: 'READY', evidenceCount: 36 }); // the agent-level switches are untouched
      expect(await context.getStyleBlockFor(tenantId, self.id)).toBe(styleBefore); // the learned style still shapes replies

      await settings.update(tenantId, adminId, { learningPaused: false });
      expect(await seedSynthetic(prisma, tenantId, [{ userId: adminId, persona: AMA }], 2)).toMatchObject({ learned: 2 });
    });
  });

  describe('customer-facing AI credits are never affected', () => {
    it('opting in, seeding, pausing, an outdated notice and resuming leave the balance and the credit tables untouched', async () => {
      open();
      const { tenantId, adminId } = await synthetic();
      await prisma.tenant.update({ where: { id: tenantId }, data: { aiCredits: 1234 } });

      await optInSyntheticWorkspace(prisma, tenantId, adminId);
      await seedSynthetic(prisma, tenantId, [{ userId: adminId, persona: AMA }], 5);
      await settings.update(tenantId, adminId, { learningPaused: true });
      await settings.update(tenantId, adminId, { learningPaused: false });
      process.env['AI_LEARNING_RETENTION_ENABLED'] = 'true';
      await settings.get(tenantId);

      expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })).aiCredits).toBe(1234);
      expect(await prisma.aiCreditTransaction.count({ where: { tenantId } })).toBe(0);
      expect(await prisma.aiCreditReservation.count({ where: { tenantId } })).toBe(0);
    });
  });
});
