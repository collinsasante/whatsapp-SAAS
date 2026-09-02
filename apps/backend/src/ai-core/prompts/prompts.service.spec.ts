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
      prisma.aiPromptTemplate.findUnique.mockResolvedValue({
        versions: [{ id: 'v1', templateId: 't1', version: '1.0.0', body: 'x', variables: [] }],
      });

      await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);
      await service.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);

      expect(prisma.aiPromptTemplate.create).not.toHaveBeenCalled();
    });

    it('caches the active version and does not re-query within the TTL', async () => {
      prisma.aiPromptTemplate.findUnique.mockResolvedValue({
        versions: [{ id: 'v1', templateId: 't1', version: '1.0.0', body: 'x', variables: [] }],
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
