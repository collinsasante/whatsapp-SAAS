import { NotFoundException } from '@nestjs/common';
import { PromptsService } from './prompts.service';
import { RESPONDER_SYSTEM_TEMPLATE_KEY } from './seed/responder-system.v1';

function buildPrismaMock() {
  return {
    aiPromptTemplate: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
    aiPromptVersion: {
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
}

describe('PromptsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: PromptsService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new PromptsService(prisma as any);
  });

  describe('getActiveVersion', () => {
    it('seeds the default template on first call when none exists', async () => {
      prisma.aiPromptTemplate.findUnique
        .mockResolvedValueOnce(null) // ensureSeeded check
        .mockResolvedValueOnce({ // getActiveVersion lookup, post-seed
          versions: [{ id: 'v1', templateId: 't1', version: '1.0.0', body: 'hi {{business_name}}', variables: ['business_name'] }],
        });

      const result = await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);

      expect(prisma.aiPromptTemplate.create).toHaveBeenCalledTimes(1);
      expect(result.version).toBe('1.0.0');
      expect(result.body).toBe('hi {{business_name}}');
    });

    it('does not re-seed on a second call (skips the create)', async () => {
      // version matches RESPONDER_SYSTEM_VERSION so ensureVersion's upgrade path
      // (a separate concern, covered below) short-circuits immediately.
      prisma.aiPromptTemplate.findUnique.mockResolvedValue({
        versions: [{ id: 'v1', templateId: 't1', version: '1.1.0', body: 'x', variables: [] }],
      });

      await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);
      await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);

      expect(prisma.aiPromptTemplate.create).not.toHaveBeenCalled();
    });

    it('caches the active version and does not re-query within the TTL', async () => {
      prisma.aiPromptTemplate.findUnique.mockResolvedValue({
        versions: [{ id: 'v1', templateId: 't1', version: '1.1.0', body: 'x', variables: [] }],
      });

      await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);
      await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);
      await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);

      // One call from ensureSeeded's existence check + one from the first getActiveVersion lookup;
      // the second and third calls should be served from cache.
      expect(prisma.aiPromptTemplate.findUnique).toHaveBeenCalledTimes(2);
    });

    it('throws NotFoundException when the template has no ACTIVE version', async () => {
      prisma.aiPromptTemplate.findUnique.mockResolvedValue({ versions: [] });

      await expect(service.getActiveVersion('some.other.key')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('ensureVersion (Verz-AI unification, Phase D auto-upgrade)', () => {
    it('auto-activates the new version when the current ACTIVE one is untouched from the original v1.0.0 seed', async () => {
      const { RESPONDER_SYSTEM_BODY_V1_0_0 } = jest.requireActual('./seed/responder-system.v1');
      prisma.aiPromptTemplate.findUnique.mockResolvedValue({
        id: 't1',
        versions: [{ id: 'v-old', templateId: 't1', version: '1.0.0', body: RESPONDER_SYSTEM_BODY_V1_0_0, variables: [] }],
      });
      prisma.aiPromptVersion.findFirst.mockResolvedValue(null);
      prisma.aiPromptVersion.create.mockResolvedValue({ id: 'v-new', version: '1.1.0', status: 'ACTIVE' });

      await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);

      expect(prisma.aiPromptVersion.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ version: '1.1.0', status: 'ACTIVE' }),
      }));
      expect(prisma.aiPromptVersion.update).toHaveBeenCalledWith({ where: { id: 'v-old' }, data: { status: 'ARCHIVED' } });
    });

    it('creates the new version as DRAFT (never overwriting) when the current ACTIVE one was customized', async () => {
      prisma.aiPromptTemplate.findUnique.mockResolvedValue({
        id: 't1',
        versions: [{ id: 'v-old', templateId: 't1', version: '1.0.0', body: 'a tenant admin wrote this', variables: [] }],
      });
      prisma.aiPromptVersion.findFirst.mockResolvedValue(null);
      prisma.aiPromptVersion.create.mockResolvedValue({ id: 'v-new', version: '1.1.0', status: 'DRAFT' });

      await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);

      expect(prisma.aiPromptVersion.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ version: '1.1.0', status: 'DRAFT' }),
      }));
      expect(prisma.aiPromptVersion.update).not.toHaveBeenCalled();
    });

    it('does nothing when a 1.1.0 version already exists (idempotent across restarts)', async () => {
      prisma.aiPromptTemplate.findUnique.mockResolvedValue({
        id: 't1',
        versions: [{ id: 'v-old', templateId: 't1', version: '1.0.0', body: 'x', variables: [] }],
      });
      prisma.aiPromptVersion.findFirst.mockResolvedValue({ id: 'v-new', version: '1.1.0' });

      await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);

      expect(prisma.aiPromptVersion.create).not.toHaveBeenCalled();
    });
  });

  describe('activateVersion', () => {
    it('archives the currently-active version and activates the target in one transaction', async () => {
      prisma.aiPromptVersion.findFirst.mockResolvedValue({ id: 'v2', templateId: 't1', status: 'DRAFT' });
      prisma.aiPromptTemplate.findUniqueOrThrow.mockResolvedValue({ id: 't1', key: RESPONDER_SYSTEM_TEMPLATE_KEY });
      prisma.aiPromptVersion.findUniqueOrThrow.mockResolvedValue({ id: 'v2', status: 'ACTIVE' });

      const result = await service.activateVersion('t1', 'v2');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.aiPromptVersion.updateMany).toHaveBeenCalledWith({
        where: { templateId: 't1', status: 'ACTIVE' },
        data: { status: 'ARCHIVED' },
      });
      expect(result.status).toBe('ACTIVE');
    });

    it('rejects re-activating an already-archived version', async () => {
      prisma.aiPromptVersion.findFirst.mockResolvedValue({ id: 'v1', templateId: 't1', status: 'ARCHIVED' });

      await expect(service.activateVersion('t1', 'v1')).rejects.toThrow('Cannot re-activate an archived version');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a version that does not belong to the template', async () => {
      prisma.aiPromptVersion.findFirst.mockResolvedValue(null);

      await expect(service.activateVersion('t1', 'nonexistent')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
