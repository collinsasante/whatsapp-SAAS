import { ConflictException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@whatsapp-platform/shared-types';
import { AiLearningCostService } from './learning-cost.service';
import { AiLearningSettingsService } from './learning-settings.service';
import { AiLearningController } from './ai-learning.controller';
import { UpdateLearningSettingsDto } from './dto/ai-learning.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { dbSuite, makeFixtures, newTestClient } from './testing/db-test-env';

const prisma = newTestClient();
const fx = prisma ? makeFixtures(prisma) : (undefined as unknown as ReturnType<typeof makeFixtures>);

dbSuite('AiLearningSettingsService against a real PostgreSQL', () => {
  const svc = prisma ? new AiLearningSettingsService(prisma as never, new AiLearningCostService(prisma as never)) : (undefined as unknown as AiLearningSettingsService);
  afterEach(() => { delete process.env['AI_LEARNING_OPT_IN_OPEN']; });
  afterAll(async () => { await fx.cleanup(); await prisma.$disconnect(); });

  const audits = (tenantId: string) => prisma.aiLearningAuditLog.findMany({ where: { tenantId, action: 'learning.settings_updated' }, orderBy: { createdAt: 'asc' } });

  describe('defaults', () => {
    it('a workspace with no row is opted OUT, not paused, with approved guidance ON, and learning is not active', async () => {
      const tenantId = await fx.tenant();
      await expect(svc.get(tenantId)).resolves.toMatchObject({ learningEnabled: false, learningPaused: false, approvedGuidanceEnabled: true, learningActive: false, enabledAt: null });
      expect(await prisma.aiLearningSettings.count({ where: { tenantId } })).toBe(0); // reading creates nothing
      expect(await svc.isLearningActive(tenantId)).toBe(false);
    });

    it('reports whether the platform currently allows opt-in', async () => {
      const tenantId = await fx.tenant();
      expect((await svc.get(tenantId)).optInAvailable).toBe(false);
      process.env['AI_LEARNING_OPT_IN_OPEN'] = 'true';
      expect((await svc.get(tenantId)).optInAvailable).toBe(true);
    });
  });

  describe('opting in', () => {
    it('is refused while the platform privacy gate is closed, even with the acknowledgement', async () => {
      const tenantId = await fx.tenant();
      const admin = await fx.user(tenantId);
      await expect(svc.update(tenantId, admin.id, { learningEnabled: true, acknowledgeDisclosure: true })).rejects.toBeInstanceOf(ForbiddenException);
      expect(await prisma.aiLearningSettings.count({ where: { tenantId } })).toBe(0);
    });

    it('is refused without the disclosure acknowledgement', async () => {
      process.env['AI_LEARNING_OPT_IN_OPEN'] = 'true';
      const tenantId = await fx.tenant();
      const admin = await fx.user(tenantId);
      await expect(svc.update(tenantId, admin.id, { learningEnabled: true })).rejects.toBeInstanceOf(ConflictException);
      await expect(svc.update(tenantId, admin.id, { learningEnabled: true, acknowledgeDisclosure: false })).rejects.toBeInstanceOf(ConflictException);
      expect(await svc.isLearningActive(tenantId)).toBe(false);
    });

    it('succeeds with the gate open and the acknowledgement, recording who and when, and audits the change', async () => {
      process.env['AI_LEARNING_OPT_IN_OPEN'] = 'true';
      const tenantId = await fx.tenant();
      const admin = await fx.user(tenantId);

      const view = await svc.update(tenantId, admin.id, { learningEnabled: true, acknowledgeDisclosure: true });

      expect(view).toMatchObject({ learningEnabled: true, learningPaused: false, learningActive: true });
      const row = await prisma.aiLearningSettings.findUniqueOrThrow({ where: { tenantId } });
      expect(row).toMatchObject({ enabledById: admin.id });
      expect(row.enabledAt).toBeInstanceOf(Date);
      const [audit] = await audits(tenantId);
      expect(audit).toMatchObject({ actorId: admin.id, targetType: 'learning_settings', targetId: row.id });
      expect(audit!.previousState).toMatchObject({ learningEnabled: false });
      expect(audit!.newState).toMatchObject({ learningEnabled: true });
      expect(Object.keys(audit!.newState as object).sort()).toEqual(['approvedGuidanceEnabled', 'learningEnabled', 'learningPaused']); // flags only, no free text
    });

    it('turning learning OFF is always allowed, including while the gate is closed', async () => {
      process.env['AI_LEARNING_OPT_IN_OPEN'] = 'true';
      const tenantId = await fx.tenant();
      const admin = await fx.user(tenantId);
      await svc.update(tenantId, admin.id, { learningEnabled: true, acknowledgeDisclosure: true });
      delete process.env['AI_LEARNING_OPT_IN_OPEN'];

      await expect(svc.update(tenantId, admin.id, { learningEnabled: false })).resolves.toMatchObject({ learningEnabled: false, learningActive: false });
    });

    it('re-sending learningEnabled: true while already enabled needs no acknowledgement and records no change', async () => {
      process.env['AI_LEARNING_OPT_IN_OPEN'] = 'true';
      const tenantId = await fx.tenant();
      const admin = await fx.user(tenantId);
      await svc.update(tenantId, admin.id, { learningEnabled: true, acknowledgeDisclosure: true });
      delete process.env['AI_LEARNING_OPT_IN_OPEN'];

      await expect(svc.update(tenantId, admin.id, { learningEnabled: true })).resolves.toMatchObject({ learningEnabled: true });
      expect(await audits(tenantId)).toHaveLength(1);
    });
  });

  describe('the three switches are independent', () => {
    async function optedIn() {
      process.env['AI_LEARNING_OPT_IN_OPEN'] = 'true';
      const tenantId = await fx.tenant();
      const admin = await fx.user(tenantId);
      await svc.update(tenantId, admin.id, { learningEnabled: true, acknowledgeDisclosure: true });
      return { tenantId, adminId: admin.id };
    }

    it('pausing stops learning but keeps the opt-in and the guidance switch; resuming restores it', async () => {
      const { tenantId, adminId } = await optedIn();
      await expect(svc.update(tenantId, adminId, { learningPaused: true })).resolves.toMatchObject({ learningEnabled: true, learningPaused: true, approvedGuidanceEnabled: true, learningActive: false });
      expect(await svc.isLearningActive(tenantId)).toBe(false);
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
    it('changing one workspace never changes another', async () => {
      process.env['AI_LEARNING_OPT_IN_OPEN'] = 'true';
      const a = await fx.tenant('A');
      const b = await fx.tenant('B');
      const adminA = await fx.user(a);
      await svc.update(a, adminA.id, { learningEnabled: true, acknowledgeDisclosure: true });
      await svc.update(a, adminA.id, { approvedGuidanceEnabled: false });

      await expect(svc.get(b)).resolves.toMatchObject({ learningEnabled: false, approvedGuidanceEnabled: true });
      expect(await prisma.aiLearningAuditLog.count({ where: { tenantId: b } })).toBe(0);
    });
  });

  describe('the API surface', () => {
    // Exactly the options main.ts uses, including implicit conversion (which would turn the string "false" into true).
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } });
    const validate = (body: unknown) => pipe.transform(body, { type: 'body', metatype: UpdateLearningSettingsDto });

    it('rejects an attempt to set the platform-funded budget or any other field', async () => {
      await expect(validate({ monthlyBudgetMicros: '999999999999' })).rejects.toBeDefined();
      await expect(validate({ tenantId: 'someone-else' })).rejects.toBeDefined();
    });

    it.each([['learningEnabled', 'yes'], ['learningPaused', 'false'], ['learningPaused', 'true'], ['approvedGuidanceEnabled', ''], ['acknowledgeDisclosure', 'true'], ['learningPaused', 1], ['learningPaused', 0], ['learningEnabled', null]])(
      'rejects %s = %j instead of coercing it (the string "false" must never become true)', async (field, value) => {
        await expect(validate({ [field]: value })).rejects.toBeDefined();
      });

    it('accepts the four documented fields', async () => {
      await expect(validate({ learningEnabled: true, learningPaused: false, approvedGuidanceEnabled: true, acknowledgeDisclosure: true })).resolves.toBeDefined();
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
