import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@whatsapp-platform/shared-types';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { DigitalSelfController } from './digital-self.controller';
import { DigitalSelfService } from './digital-self.service';

function build(opts: { conv?: Record<string, unknown> | null; affected?: string[]; deletedPerSelf?: number } = {}) {
  const calls: string[] = [];
  const conv = opts.conv === undefined ? { id: 'c1', assignedToId: 'kofi' } : opts.conv;
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    digitalSelfLearningEvent: {
      deleteMany: jest.fn(async (_args: { where: Record<string, unknown> }) => { calls.push('delete'); return { count: opts.deletedPerSelf ?? 2 }; }),
      findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), findFirst: jest.fn().mockResolvedValue(null),
    },
    digitalSelf: { findFirstOrThrow: jest.fn().mockResolvedValue({ id: 'ds', enabled: true, learningPaused: false, profile: {} }), update: jest.fn(async () => { calls.push('rebuild'); return {}; }) },
  };
  const prisma = {
    conversation: {
      findFirst: jest.fn(async ({ where }) => (conv && where.id === 'c1' && where.tenantId === 't1' ? { ...conv } : null)),
      updateMany: jest.fn(async ({ where }) => { calls.push('flag'); return { count: conv && where.tenantId === 't1' ? 1 : 0 }; }),
    },
    digitalSelfLearningEvent: { findMany: jest.fn(async (_args: { where: Record<string, unknown> }) => (opts.affected ?? ['dsAma', 'dsKofi']).map((digitalSelfId) => ({ digitalSelfId }))) },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { svc: new DigitalSelfService(prisma as never), prisma, tx, calls };
}
const admin = { id: 'boss', role: 'ADMIN' };

describe('setConversationLearningExcluded', () => {
  it('sets the flag FIRST, then removes the evidence and rebuilds each affected profile', async () => {
    const { svc, calls, prisma } = build();
    const result = await svc.setConversationLearningExcluded('t1', 'c1', true, admin);
    expect(calls).toEqual(['flag', 'delete', 'rebuild', 'delete', 'rebuild']);
    expect(result).toMatchObject({ excluded: true, evidenceRemoved: 4, profilesRebuilt: 2 });
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', tenantId: 't1' },
      data: expect.objectContaining({ digitalSelfLearningExcluded: true, digitalSelfLearningExcludedById: 'boss' }),
    });
  });

  it('only touches evidence of this tenant and this conversation', async () => {
    const { svc, tx, prisma } = build();
    await svc.setConversationLearningExcluded('t1', 'c1', true, admin);
    expect(prisma.digitalSelfLearningEvent.findMany.mock.calls[0][0].where).toEqual({ tenantId: 't1', conversationId: 'c1' });
    for (const call of tx.digitalSelfLearningEvent.deleteMany.mock.calls) expect(call[0].where).toMatchObject({ tenantId: 't1', conversationId: 'c1' });
  });

  it('does not rebuild a profile that had nothing from this conversation', async () => {
    const { svc, calls } = build({ deletedPerSelf: 0 });
    expect((await svc.setConversationLearningExcluded('t1', 'c1', true, admin)).evidenceRemoved).toBe(0);
    expect(calls).not.toContain('rebuild');
  });

  it('lifting the exclusion only clears the flag: nothing is removed or brought back', async () => {
    const { svc, calls } = build();
    const result = await svc.setConversationLearningExcluded('t1', 'c1', false, admin);
    expect(calls).toEqual(['flag']);
    expect(result).toMatchObject({ excluded: false, excludedAt: null, evidenceRemoved: 0 });
  });

  it('lets an admin, or the agent who owns the conversation; refuses other agents, viewers and other tenants', async () => {
    await expect(build().svc.setConversationLearningExcluded('t1', 'c1', true, { id: 'kofi', role: 'AGENT' })).resolves.toBeDefined();
    const other = build();
    await expect(other.svc.setConversationLearningExcluded('t1', 'c1', true, { id: 'ama', role: 'AGENT' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(other.svc.setConversationLearningExcluded('t1', 'c1', true, { id: 'v', role: 'VIEWER' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(other.svc.setConversationLearningExcluded('t2', 'c1', true, admin)).rejects.toBeInstanceOf(NotFoundException);
    expect(other.calls).toEqual([]); // nothing was written by any refused call
  });
});

describe('exclusion endpoint authorization', () => {
  it('is available to agents and up; the service decides admin versus owner', () => {
    expect(Reflect.getMetadata(ROLES_KEY, DigitalSelfController.prototype.setLearningExclusion)).toEqual([UserRole.AGENT]);
  });
});
