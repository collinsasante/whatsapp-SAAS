import { ForbiddenException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';

function build(existing: Record<string, unknown>) {
  const prisma = { conversation: { update: jest.fn().mockResolvedValue({ id: 'c1', status: 'RESOLVED' }) } };
  const svc = Object.create(ConversationsService.prototype) as Record<string, unknown>;
  Object.assign(svc, {
    prisma,
    findOne: jest.fn().mockResolvedValue({ id: 'c1', contactId: 'ct1', ...existing }),
    recordEvent: jest.fn().mockResolvedValue(undefined),
    activityLogService: { log: jest.fn() },
    realtimeService: { emitConversationStateChanged: jest.fn() },
  });
  return { svc: svc as unknown as ConversationsService, prisma };
}

describe('ConversationsService.resolve -- authorization', () => {
  const ownedByOther = { status: 'INTERVENED', assignedTo: { id: 'other', isAiAgent: false } };

  it('refuses to let a non-owner agent close another human agent\'s conversation', async () => {
    const { svc, prisma } = build(ownedByOther);
    await expect(svc.resolve('t1', 'c1', 'u1', 'AGENT')).rejects.toThrow(ForbiddenException);
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('lets the owner, an admin, or anyone for an AI-owned/unassigned conversation close it', async () => {
    for (const [existing, userId, role] of [
      [ownedByOther, 'other', 'AGENT'],
      [ownedByOther, 'u1', 'ADMIN'],
      [{ status: 'OPEN', assignedTo: { id: 'ai', isAiAgent: true } }, 'u1', 'AGENT'],
      [{ status: 'OPEN', assignedTo: null }, 'u1', 'AGENT'],
    ] as const) {
      const { svc, prisma } = build(existing);
      await svc.resolve('t1', 'c1', userId, role);
      expect(prisma.conversation.update).toHaveBeenCalledTimes(1);
    }
  });

  it('is idempotent: a stale re-resolve does not overwrite resolvedAt/resolvedById', async () => {
    const { svc, prisma } = build({ status: 'RESOLVED', assignedTo: null });
    await svc.resolve('t1', 'c1', 'u1', 'AGENT');
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });
});
