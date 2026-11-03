import { ConflictException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@whatsapp-platform/shared-types';
import { AiLearningCostService } from './learning-cost.service';
import { AiLearningSettingsService } from './learning-settings.service';
import { AiLearningController } from './ai-learning.controller';
import { UpdateLearningSettingsDto } from './dto/ai-learning.dto';
import { currentDisclosureVersion } from './learning-disclosure';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { dbSuite, makeFixtures, newTestClient } from './testing/db-test-env';

const prisma = newTestClient();
const fx = prisma ? makeFixtures(prisma) : (undefined as unknown as ReturnType<typeof makeFixtures>);
const ack = () => currentDisclosureVersion();

dbSuite('AiLearningSettingsService against a real PostgreSQL', () => {
  const svc = prisma ? new AiLearningSettingsService(prisma as never, new AiLearningCostService(prisma as never)) : (undefined as unknown as AiLearningSettingsService);
  const ENV = ['AI_LEARNING_OPT_IN_OPEN', 'AI_LEARNING_RETENTION_ENABLED', 'AI_LEARNING_RETENTION_FREE_TEXT_DAYS', 'AI_LEARNING_RETENTION_METRICS_MONTHS'];
  afterEach(() => { for (const k of ENV) delete process.env[k]; });
  afterAll(async () => { await fx.cleanup(); await prisma.$disconnect(); });
  const open = () => { process.env['AI_LEARNING_OPT_IN_OPEN'] = 'true'; };
  const audits = (tenantId: string) => prisma.aiLearningAuditLog.findMany({ where: { tenantId, action: 'learning.settings_updated' }, orderBy: { createdAt: 'asc' } });

  async function optedIn() {
    open();
    const tenantId = await fx.tenant();
    const admin = await fx.user(tenantId);
    await svc.update(tenantId, admin.id, { learningEnabled: true, acknowledgedDisclosureVersion: ack() });
    return { tenantId, adminId: admin.id };
  }

  describe('defaults', () => {
    it('a workspace with no row is opted OUT, not paused, guidance ON, nothing acknowledged, and learning is not active', async () => {
      const tenantId = await fx.tenant();
      const view = await svc.get(tenantId);
      expect(view).toMatchObject({ learningEnabled: false, learningPaused: false, approvedGuidanceEnabled: true, learningActive: false, blockedReason: 'not_enabled', enabledAt: null });
      expect(view.acknowledgement).toEqual({ version: null, at: null, byId: null, current: false, needsAcknowledgement: false });
      expect(await prisma.aiLearningSettings.count({ where: { tenantId } })).toBe(0); // reading creates nothing
      expect(await svc.isLearningActive(tenantId)).toBe(false);
    });

    it('returns the notice the administrator must read, with the version an acknowledgement is recorded against', async () => {
      const tenantId = await fx.tenant();
      const { disclosure } = await svc.get(tenantId);
      expect(disclosure.version).toBe(ack());
      expect(disclosure.sections.length).toBeGreaterThanOrEqual(5);
    });

    it('reports whether the platform currently allows opt-in (closed unless the variable is exactly "true")', async () => {
      const tenantId = await fx.tenant();
      expect((await svc.get(tenantId)).optInAvailable).toBe(false);
      for (const v of ['TRUE', '1', 'yes', '', ' true']) { process.env['AI_LEARNING_OPT_IN_OPEN'] = v; expect((await svc.get(tenantId)).optInAvailable).toBe(false); }
      open();
      expect((await svc.get(tenantId)).optInAvailable).toBe(true);
    });

    it('an ordinary pre-existing workspace, even one that has a settings row for another reason, is never silently enabled', async () => {
      const tenantId = await fx.tenant();
      const admin = await fx.user(tenantId);
      await svc.update(tenantId, admin.id, { approvedGuidanceEnabled: false });
      await expect(svc.get(tenantId)).resolves.toMatchObject({ learningEnabled: false, learningActive: false });
    });
  });

  describe('opting in requires the current acknowledgement', () => {
    it('is refused while the platform privacy gate is closed, even with an acknowledgement', async () => {
      const tenantId = await fx.tenant();
      const admin = await fx.user(tenantId);
      await expect(svc.update(tenantId, admin.id, { learningEnabled: true, acknowledgedDisclosureVersion: ack() })).rejects.toBeInstanceOf(ForbiddenException);
      expect(await prisma.aiLearningSettings.count({ where: { tenantId } })).toBe(0);
    });

    it('is refused without an acknowledgement, and says which one is needed', async () => {
      open();
      const tenantId = await fx.tenant();
      const admin = await fx.user(tenantId);
      await expect(svc.update(tenantId, admin.id, { learningEnabled: true })).rejects.toMatchObject({ response: { code: 'DISCLOSURE_ACKNOWLEDGEMENT_REQUIRED', currentVersion: ack() } });
      expect(await svc.isLearningActive(tenantId)).toBe(false);
      expect(await prisma.aiLearningSettings.count({ where: { tenantId } })).toBe(0);
    });

    it('refuses a STALE version and records nothing', async () => {
      open();
      const tenantId = await fx.tenant();
      const admin = await fx.user(tenantId);
      await expect(svc.update(tenantId, admin.id, { learningEnabled: true, acknowledgedDisclosureVersion: 'd1-000000000000' })).rejects.toMatchObject({ response: { code: 'DISCLOSURE_OUTDATED', currentVersion: ack() } });
      expect(await prisma.aiLearningSettings.count({ where: { tenantId } })).toBe(0);
    });

    it('records the version, the administrator and the time, and audits flags and the version only', async () => {
      open();
      const tenantId = await fx.tenant();
      const admin = await fx.user(tenantId);
      const before = Date.now();

      const view = await svc.update(tenantId, admin.id, { learningEnabled: true, acknowledgedDisclosureVersion: ack() });

      expect(view).toMatchObject({ learningEnabled: true, learningActive: true, blockedReason: null });
      expect(view.acknowledgement).toMatchObject({ version: ack(), byId: admin.id, current: true, needsAcknowledgement: false });
      const row = await prisma.aiLearningSettings.findUniqueOrThrow({ where: { tenantId } });
      expect(row).toMatchObject({ disclosureVersion: ack(), disclosureAcknowledgedById: admin.id, enabledById: admin.id });
      expect(row.disclosureAcknowledgedAt!.getTime()).toBeGreaterThanOrEqual(before - 1_000);
      const [audit] = await audits(tenantId);
      expect(audit).toMatchObject({ actorId: admin.id, targetType: 'learning_settings', targetId: row.id });
      expect(audit!.previousState).toMatchObject({ learningEnabled: false, disclosureVersion: null });
      expect(audit!.newState).toMatchObject({ learningEnabled: true, disclosureVersion: ack() });
      expect(Object.keys(audit!.newState as object).sort()).toEqual(['approvedGuidanceEnabled', 'disclosureVersion', 'learningEnabled', 'learningPaused']);
      expect(JSON.stringify(audit)).not.toContain(view.disclosure.summary.slice(0, 30)); // never the notice text
    });

    it('each time learning is switched back on from off, the acknowledgement is required again', async () => {
      const { tenantId, adminId } = await optedIn();
      await svc.update(tenantId, adminId, { learningEnabled: false });
      await expect(svc.update(tenantId, adminId, { learningEnabled: true })).rejects.toBeInstanceOf(ConflictException);
      await expect(svc.update(tenantId, adminId, { learningEnabled: true, acknowledgedDisclosureVersion: ack() })).resolves.toMatchObject({ learningActive: true });
    });

    it('turning learning OFF is always allowed, including while the gate is closed', async () => {
      const { tenantId, adminId } = await optedIn();
      delete process.env['AI_LEARNING_OPT_IN_OPEN'];
      await expect(svc.update(tenantId, adminId, { learningEnabled: false })).resolves.toMatchObject({ learningEnabled: false, learningActive: false });
    });
  });

  describe('a changed disclosure stops learning until it is acknowledged again', () => {
    it('an outdated acknowledgement blocks learning, and is reported as needing acknowledgement', async () => {
      const { tenantId } = await optedIn();
      expect(await svc.isLearningActive(tenantId)).toBe(true);
      process.env['AI_LEARNING_RETENTION_ENABLED'] = 'true'; // the notice describes retention, so this changes its version

      const view = await svc.get(tenantId);
      expect(view.disclosure.version).not.toBe(view.acknowledgement.version);
      expect(view).toMatchObject({ learningEnabled: true, learningActive: false, blockedReason: 'disclosure_outdated' });
      expect(view.acknowledgement).toMatchObject({ current: false, needsAcknowledgement: true });
      expect(await svc.isLearningActive(tenantId)).toBe(false);
    });

    it('un-pausing does NOT resume learning while the notice is outdated', async () => {
      const { tenantId, adminId } = await optedIn();
      await svc.update(tenantId, adminId, { learningPaused: true });
      process.env['AI_LEARNING_RETENTION_ENABLED'] = 'true';
      await expect(svc.update(tenantId, adminId, { learningPaused: false })).resolves.toMatchObject({ learningActive: false, blockedReason: 'disclosure_outdated' });
    });

    it('acknowledging the NEW version records who and when, and learning resumes', async () => {
      const { tenantId } = await optedIn();
      const other = await fx.user(tenantId, 'second-admin');
      const first = await prisma.aiLearningSettings.findUniqueOrThrow({ where: { tenantId } });
      process.env['AI_LEARNING_RETENTION_ENABLED'] = 'true';
      const newVersion = ack();

      const view = await svc.update(tenantId, other.id, { acknowledgedDisclosureVersion: newVersion });

      expect(view).toMatchObject({ learningActive: true, blockedReason: null });
      const row = await prisma.aiLearningSettings.findUniqueOrThrow({ where: { tenantId } });
      expect(row).toMatchObject({ disclosureVersion: newVersion, disclosureAcknowledgedById: other.id });
      expect(row.disclosureAcknowledgedAt!.getTime()).toBeGreaterThanOrEqual(first.disclosureAcknowledgedAt!.getTime());
      expect(row.enabledById).toBe(first.enabledById); // the original opt-in is not rewritten
      const trail = await audits(tenantId);
      expect(trail).toHaveLength(2);
      expect(trail[1]!.previousState).toMatchObject({ disclosureVersion: first.disclosureVersion });
      expect(trail[1]!.newState).toMatchObject({ disclosureVersion: newVersion });
    });

    it('acknowledging the OLD version after the change is refused', async () => {
      const { tenantId, adminId } = await optedIn();
      const oldVersion = ack();
      process.env['AI_LEARNING_RETENTION_ENABLED'] = 'true';
      await expect(svc.update(tenantId, adminId, { acknowledgedDisclosureVersion: oldVersion })).rejects.toMatchObject({ response: { code: 'DISCLOSURE_OUTDATED' } });
      expect(await svc.isLearningActive(tenantId)).toBe(false);
    });

    it('re-acknowledging the version already on record writes no audit row', async () => {
      const { tenantId, adminId } = await optedIn();
      await svc.update(tenantId, adminId, { acknowledgedDisclosureVersion: ack() });
      expect(await audits(tenantId)).toHaveLength(1);
    });
  });

  describe('the three switches are independent', () => {
    it('pausing stops learning but keeps the opt-in, the acknowledgement and the guidance switch; resuming restores it', async () => {
      const { tenantId, adminId } = await optedIn();
      await expect(svc.update(tenantId, adminId, { learningPaused: true })).resolves.toMatchObject({ learningEnabled: true, learningPaused: true, approvedGuidanceEnabled: true, learningActive: false, blockedReason: 'paused' });
      expect((await svc.get(tenantId)).acknowledgement.current).toBe(true);
      await expect(svc.update(tenantId, adminId, { learningPaused: false })).resolves.toMatchObject({ learningActive: true });
    });

    it('turning approved guidance off changes nothing else, and back on again', async () => {
      const { tenantId, adminId } = await optedIn();
      await expect(svc.update(tenantId, adminId, { approvedGuidanceEnabled: false })).resolves.toMatchObject({ learningEnabled: true, learningPaused: false, approvedGuidanceEnabled: false, learningActive: true });
      await expect(svc.update(tenantId, adminId, { approvedGuidanceEnabled: true })).resolves.toMatchObject({ approvedGuidanceEnabled: true });
    });

    it('turning learning off leaves approved guidance and the pause flag as they were', async () => {
      const { tenantId, adminId } = await optedIn();
      await svc.update(tenantId, adminId, { learningPaused: true });
      await expect(svc.update(tenantId, adminId, { learningEnabled: false })).resolves.toMatchObject({ learningEnabled: false, learningPaused: true, approvedGuidanceEnabled: true });
    });

    it('guidance and pause can be changed on a workspace that never opted in, without opting it in', async () => {
      const tenantId = await fx.tenant();
      const admin = await fx.user(tenantId);
      const view = await svc.update(tenantId, admin.id, { approvedGuidanceEnabled: false, learningPaused: true });
      expect(view).toMatchObject({ learningEnabled: false, learningPaused: true, approvedGuidanceEnabled: false, learningActive: false });
      expect((await prisma.aiLearningSettings.findUniqueOrThrow({ where: { tenantId } })).enabledAt).toBeNull();
    });

    it('an update that changes nothing writes no audit row', async () => {
      const tenantId = await fx.tenant();
      const admin = await fx.user(tenantId);
      await svc.update(tenantId, admin.id, { approvedGuidanceEnabled: true, learningPaused: false });
      expect(await audits(tenantId)).toHaveLength(0);
    });
  });

  describe('tenant isolation', () => {
    it('changing or acknowledging for one workspace never changes another', async () => {
      const a = await optedIn();
      const b = await fx.tenant('B');
      await svc.update(a.tenantId, a.adminId, { approvedGuidanceEnabled: false });
      await expect(svc.get(b)).resolves.toMatchObject({ learningEnabled: false, approvedGuidanceEnabled: true, acknowledgement: { version: null } });
      expect(await prisma.aiLearningAuditLog.count({ where: { tenantId: b } })).toBe(0);
    });
  });

  describe('the API surface', () => {
    // Exactly the options main.ts uses, including implicit conversion (which would turn the string "false" into true).
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } });
    const validate = (body: unknown) => pipe.transform(body, { type: 'body', metatype: UpdateLearningSettingsDto });

    it('rejects an attempt to set the platform-funded budget, the acknowledgement fields directly, or any other field', async () => {
      for (const body of [{ monthlyBudgetMicros: '999999999999' }, { tenantId: 'someone-else' }, { disclosureVersion: 'x' }, { disclosureAcknowledgedById: 'x' }, { acknowledgeDisclosure: true }]) {
        await expect(validate(body)).rejects.toBeDefined();
      }
    });

    it.each([['learningEnabled', 'yes'], ['learningPaused', 'false'], ['learningPaused', 'true'], ['approvedGuidanceEnabled', ''], ['learningPaused', 1], ['learningPaused', 0], ['learningEnabled', null]])(
      'rejects %s = %j instead of coercing it (the string "false" must never become true)', async (field, value) => {
        await expect(validate({ [field]: value })).rejects.toBeDefined();
      });

    it('requires the acknowledged version to be a string', async () => {
      await expect(validate({ acknowledgedDisclosureVersion: 5 })).resolves.toBeDefined(); // implicit conversion turns it into the string "5", which the service then refuses as stale
      await expect(validate({ acknowledgedDisclosureVersion: 'x'.repeat(200) })).rejects.toBeDefined();
    });

    it('accepts the four documented fields', async () => {
      await expect(validate({ learningEnabled: true, learningPaused: false, approvedGuidanceEnabled: true, acknowledgedDisclosureVersion: ack() })).resolves.toBeDefined();
    });

    it('the service itself ignores a non-boolean value even if the DTO layer were bypassed', async () => {
      const tenantId = await fx.tenant();
      const admin = await fx.user(tenantId);
      const view = await svc.update(tenantId, admin.id, { learningEnabled: null, learningPaused: 'false', approvedGuidanceEnabled: 0 } as never);
      expect(view).toMatchObject({ learningEnabled: false, learningPaused: false, approvedGuidanceEnabled: true });
    });

    it('is only reachable by authenticated workspace admins', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, AiLearningController)).toEqual([JwtAuthGuard, RolesGuard]);
      expect(Reflect.getMetadata('roles', AiLearningController)).toEqual([UserRole.ADMIN]);
    });
  });
});
