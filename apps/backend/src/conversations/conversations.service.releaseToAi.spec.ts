import { NotFoundException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { AiResponderService } from '../ai/ai-responder.service';

function buildDeps() {
  const prisma = {
    conversation: { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    conversationEvent: { create: jest.fn() },
  };
  const moduleRef = { get: jest.fn() };
  const activityLogService = { log: jest.fn() };
  const realtimeService = { emitConversationStateChanged: jest.fn() };
  const notificationsService = {};
  const airtableService = {};
  const aiCompletionService = {};
  const snoozeQueue = {};
  return { prisma, moduleRef, activityLogService, realtimeService, notificationsService, airtableService, aiCompletionService, snoozeQueue };
}

function buildService(deps: ReturnType<typeof buildDeps>) {
  return new ConversationsService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deps.prisma as any,
    deps.activityLogService as any,
    deps.notificationsService as any,
    deps.realtimeService as any,
    deps.airtableService as any,
    deps.moduleRef as any,
    deps.aiCompletionService as any,
    deps.snoozeQueue as any,
  );
}

describe('ConversationsService.releaseToAi', () => {
  it('reassigns the conversation to the tenant\'s Verz AI agent and reopens it', async () => {
    const deps = buildDeps();
    const human = { id: 'human-user-1', isAiAgent: false };
    const reopened = { id: 'c1', tenantId: 't1', contactId: 'contact1', status: 'OPEN', assignedToId: 'verz-user-1', assignedTo: { id: 'verz-user-1', isAiAgent: true } };
    deps.prisma.conversation.findFirst
      .mockResolvedValueOnce({ id: 'c1', tenantId: 't1', contactId: 'contact1', status: 'INTERVENED', assignedToId: 'human-user-1', assignedTo: human })
      .mockResolvedValue(reopened);
    const ai = {
      findOrCreateVerzAgent: jest.fn().mockResolvedValue({ id: 'verz-user-1', name: 'Verz', avatarUrl: null }),
      getMode: jest.fn().mockResolvedValue('AUTO_REPLY'),
      evaluateAvailability: jest.fn().mockResolvedValue({ available: true, reason: null }),
    };
    deps.moduleRef.get.mockReturnValue(ai);
    deps.prisma.conversation.updateMany.mockResolvedValue({ count: 1 });

    const service = buildService(deps);
    const result = await service.releaseToAi('t1', 'c1', 'human-user-1', 'AGENT');

    expect(deps.moduleRef.get).toHaveBeenCalledWith(AiResponderService, { strict: false });
    expect(ai.findOrCreateVerzAgent).toHaveBeenCalledWith('t1');
    expect(deps.prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', tenantId: 't1', assignedToId: 'human-user-1' },
      data: expect.objectContaining({ assignedToId: 'verz-user-1', status: 'OPEN', intervenedAt: null, slaDeadline: null }),
    });
    expect(deps.activityLogService.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', conversationId: 'c1', userId: 'human-user-1' }));
    expect(deps.realtimeService.emitConversationStateChanged).toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'c1', status: 'OPEN', assignedTo: { id: 'verz-user-1', isAiAgent: true }, aiHandling: { willAutoReply: true } });
  });

  it('throws if the conversation does not exist', async () => {
    const deps = buildDeps();
    deps.prisma.conversation.findFirst.mockResolvedValue(null);
    const service = buildService(deps);

    await expect(service.releaseToAi('t1', 'missing', 'human-user-1')).rejects.toThrow(NotFoundException);
    expect(deps.prisma.conversation.update).not.toHaveBeenCalled();
  });
});
