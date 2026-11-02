import { ManageSettingsService } from './manage-settings.service';

function build(previous: string | null) {
  const prisma = {
    tenantSettings: {
      findUnique: jest.fn().mockResolvedValue({ aiTrialStartedAt: new Date(), aiEnabled: true, aiPersonality: previous }),
      upsert: jest.fn().mockResolvedValue({ tenantId: 't1' }),
    },
    aiAgent: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const service = new ManageSettingsService(prisma as never, {} as never, {} as never, { getJob: jest.fn(), add: jest.fn() } as never);
  return { service, prisma };
}

describe('ManageSettingsService.updateAi: the workspace personality reaches the default AI agent', () => {
  it('moves a default agent that still carries the previous workspace personality (or none) to the new one', async () => {
    const { service, prisma } = build('Formal.');
    await service.updateAi('t1', { aiPersonality: 'Warm and playful.' });
    expect(prisma.aiAgent.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', isDefault: true, OR: [{ personality: null }, { personality: 'Formal.' }] },
      data: { personality: 'Warm and playful.' },
    });
  });

  it('with no previous personality only an agent that has none follows', async () => {
    const { service, prisma } = build(null);
    await service.updateAi('t1', { aiPersonality: 'Warm.' });
    expect(prisma.aiAgent.updateMany.mock.calls[0][0].where).toEqual({ tenantId: 't1', isDefault: true, OR: [{ personality: null }] });
  });

  it('never targets another tenant\'s agents or a non-default agent', async () => {
    const { service, prisma } = build('Formal.');
    await service.updateAi('t1', { aiPersonality: 'Warm.' });
    const where = prisma.aiAgent.updateMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe('t1');
    expect(where.isDefault).toBe(true);
  });

  it('does nothing to agents when the personality is not part of the update', async () => {
    const { service, prisma } = build('Formal.');
    await service.updateAi('t1', { aiMode: 'SUGGESTION' });
    expect(prisma.aiAgent.updateMany).not.toHaveBeenCalled();
  });

  it('a failure syncing the agent is logged and does not fail the settings save', async () => {
    const { service, prisma } = build('Formal.');
    prisma.aiAgent.updateMany.mockRejectedValue(new Error('db down'));
    await expect(service.updateAi('t1', { aiPersonality: 'Warm.' })).resolves.toEqual({ tenantId: 't1' });
  });
});
