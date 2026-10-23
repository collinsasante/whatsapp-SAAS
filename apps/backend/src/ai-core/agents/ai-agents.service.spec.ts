import { ConflictException } from '@nestjs/common';
import { AiAgentsService } from './ai-agents.service';
import { DEFAULT_MODEL_KEY } from '../models/model-catalog';

function buildPrismaMock() {
  return {
    aiAgent: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    tenantSettings: {
      findUnique: jest.fn(),
    },
  };
}

function buildAiResponderMock() {
  return { findOrCreateVerzAgent: jest.fn() };
}

describe('AiAgentsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let aiResponder: ReturnType<typeof buildAiResponderMock>;
  let service: AiAgentsService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    aiResponder = buildAiResponderMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new AiAgentsService(prisma as any, aiResponder as any);
  });

  describe('create', () => {
    it('rejects a duplicate agent name for the same tenant', async () => {
      prisma.aiAgent.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.create('tenant-1', { name: 'Sales Bot' })).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.aiAgent.create).not.toHaveBeenCalled();
    });

    it('creates an agent with default model/language/tokens when unspecified', async () => {
      prisma.aiAgent.findUnique.mockResolvedValue(null);
      prisma.aiAgent.create.mockResolvedValue({ id: 'a1', name: 'Sales Bot' });

      await service.create('tenant-1', { name: 'Sales Bot' });

      expect(prisma.aiAgent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          name: 'Sales Bot',
          language: 'en',
          modelKey: DEFAULT_MODEL_KEY,
          maxResponseTokens: 400,
        }),
      });
    });
  });

  describe('findOrCreateDefaultAgent', () => {
    it('returns the existing default agent without creating a new synthetic user', async () => {
      prisma.aiAgent.findFirst.mockResolvedValue({ id: 'default-agent', isDefault: true });

      const result = await service.findOrCreateDefaultAgent('tenant-1');

      expect(result).toEqual({ id: 'default-agent', isDefault: true });
      expect(aiResponder.findOrCreateVerzAgent).not.toHaveBeenCalled();
    });

    it('reuses the SAME synthetic isAiAgent User via AiResponderService when creating the default agent', async () => {
      prisma.aiAgent.findFirst.mockResolvedValue(null);
      aiResponder.findOrCreateVerzAgent.mockResolvedValue({ id: 'synthetic-user-1', name: 'Verz', avatarUrl: null });
      prisma.tenantSettings.findUnique.mockResolvedValue({ aiPersonality: 'Friendly and concise' });
      prisma.aiAgent.create.mockResolvedValue({ id: 'new-default', isDefault: true, agentUserId: 'synthetic-user-1' });

      await service.findOrCreateDefaultAgent('tenant-1');

      expect(aiResponder.findOrCreateVerzAgent).toHaveBeenCalledWith('tenant-1');
      expect(prisma.aiAgent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          isDefault: true,
          agentUserId: 'synthetic-user-1',
          personality: 'Friendly and concise',
        }),
      });
    });

    it('falls back to null personality when TenantSettings has none set', async () => {
      prisma.aiAgent.findFirst.mockResolvedValue(null);
      aiResponder.findOrCreateVerzAgent.mockResolvedValue({ id: 'u1', name: 'Verz', avatarUrl: null });
      prisma.tenantSettings.findUnique.mockResolvedValue(null);
      prisma.aiAgent.create.mockResolvedValue({ id: 'a1' });

      await service.findOrCreateDefaultAgent('tenant-1');

      expect(prisma.aiAgent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ personality: null }),
      });
    });
  });
});
