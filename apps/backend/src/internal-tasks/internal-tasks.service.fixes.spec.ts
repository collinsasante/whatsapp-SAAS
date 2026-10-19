import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@whatsapp-platform/shared-types';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { InternalTasksController } from './internal-tasks.controller';
import { InternalTasksService } from './internal-tasks.service';

function build(task: Record<string, unknown> | null = { id: 'k1', tenantId: 't1', status: 'OPEN', resolvedAt: null, resolvedById: null }) {
  const prisma = {
    team: { findFirst: jest.fn().mockResolvedValue(null) },
    teamMember: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue({ id: 'u2' }) },
    conversation: { findFirst: jest.fn().mockResolvedValue(null) },
    order: { findFirst: jest.fn().mockResolvedValue(null) },
    contact: { findFirst: jest.fn().mockResolvedValue(null) },
    internalTask: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'new', description: null, priority: 'NORMAL', assignedTeamId: null, conversationId: null, orderId: null, ...data })),
      findFirst: jest.fn().mockResolvedValue(task),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...task, ...data })),
    },
  };
  const svc = new InternalTasksService(prisma as never, { notifyUser: jest.fn().mockResolvedValue(null) } as never);
  return { svc, prisma };
}

describe('InternalTasksService.findAll', () => {
  it('rejects an invalid status with a 400 instead of crashing the query', async () => {
    const { svc, prisma } = build();
    await expect(svc.findAll('t1', { status: 'NOPE' })).rejects.toThrow(BadRequestException);
    expect(prisma.internalTask.findMany).not.toHaveBeenCalled();
  });
  it('is scoped to the tenant, capped, and stably ordered', async () => {
    const { svc, prisma } = build();
    await svc.findAll('tenant-A', { status: 'OPEN' });
    const args = prisma.internalTask.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ tenantId: 'tenant-A', status: 'OPEN' });
    expect(args.take).toBe(200);
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });
  it('honours a requested limit but never beyond the maximum, and never below one', async () => {
    const { svc, prisma } = build();
    await svc.findAll('t1', { limit: 99999 }); await svc.findAll('t1', { limit: 0 }); await svc.findAll('t1', { limit: 25 });
    expect(prisma.internalTask.findMany.mock.calls.map((c) => c[0].take)).toEqual([500, 1, 25]);
  });
});

describe('InternalTasksService.updateStatus', () => {
  it('resolving records who and when', async () => {
    const { svc, prisma } = build();
    await svc.updateStatus('t1', 'k1', 'DONE' as never, 'u9');
    expect(prisma.internalTask.update.mock.calls[0][0].data).toMatchObject({ status: 'DONE', resolvedById: 'u9', resolvedAt: expect.any(Date) });
  });
  it('reopening clears the old resolver instead of leaving an open task marked as resolved', async () => {
    const { svc, prisma } = build({ id: 'k1', tenantId: 't1', status: 'DONE', resolvedAt: new Date(), resolvedById: 'u9' });
    await svc.updateStatus('t1', 'k1', 'OPEN' as never, 'u1');
    expect(prisma.internalTask.update.mock.calls[0][0].data).toEqual({ status: 'OPEN', resolvedAt: null, resolvedById: null });
  });
  it('repeating the same status changes nothing (does not re-stamp the resolver)', async () => {
    const { svc, prisma } = build({ id: 'k1', tenantId: 't1', status: 'DONE', resolvedAt: new Date('2026-10-01'), resolvedById: 'u9' });
    const out = await svc.updateStatus('t1', 'k1', 'DONE' as never, 'someone-else');
    expect(prisma.internalTask.update).not.toHaveBeenCalled();
    expect(out).toMatchObject({ resolvedById: 'u9' });
  });
  it('cannot touch another tenant\'s task', async () => {
    const { svc, prisma } = build(null);
    await expect(svc.updateStatus('other', 'k1', 'DONE' as never, 'u')).rejects.toThrow(NotFoundException);
    expect(prisma.internalTask.findFirst).toHaveBeenCalledWith({ where: { id: 'k1', tenantId: 'other' } });
    expect(prisma.internalTask.update).not.toHaveBeenCalled();
  });
});

describe('InternalTasksService.assign', () => {
  it('an agent can take a task for themselves', async () => {
    const { svc, prisma } = build();
    await svc.assign('t1', 'k1', 'u2', { userId: 'u2', role: 'AGENT' });
    expect(prisma.internalTask.update).toHaveBeenCalledWith({ where: { id: 'k1' }, data: { assigneeId: 'u2' } });
  });
  it('an agent cannot hand a task to someone else, but an admin can', async () => {
    const a = build();
    await expect(a.svc.assign('t1', 'k1', 'u3', { userId: 'u2', role: 'AGENT' })).rejects.toThrow(ForbiddenException);
    expect(a.prisma.internalTask.update).not.toHaveBeenCalled();
    const b = build();
    await expect(b.svc.assign('t1', 'k1', 'u3', { userId: 'boss', role: 'ADMIN' })).resolves.toBeDefined();
  });
  it('only an active user of the same workspace can be assigned', async () => {
    const { svc, prisma } = build();
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(svc.assign('t1', 'k1', 'u2', { userId: 'u2', role: 'AGENT' })).rejects.toThrow(NotFoundException);
    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { id: 'u2', tenantId: 't1', isActive: true } });
  });
});

describe('InternalTasksService.create -- references must belong to the workspace', () => {
  it('keeps references the workspace owns', async () => {
    const { svc, prisma } = build();
    prisma.conversation.findFirst.mockResolvedValue({ id: 'c1' });
    prisma.order.findFirst.mockResolvedValue({ id: 'o1' });
    prisma.contact.findFirst.mockResolvedValue({ id: 'ct1' });
    await svc.create('t1', { department: 'Support', title: 'x', conversationId: 'c1', orderId: 'o1', contactId: 'ct1' });
    expect(prisma.internalTask.create.mock.calls[0][0].data).toMatchObject({ conversationId: 'c1', orderId: 'o1', contactId: 'ct1' });
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith({ where: { id: 'c1', tenantId: 't1' }, select: { id: true } });
  });
  it('drops a reference to another workspace\'s record (a model-supplied id) but still creates the task', async () => {
    const { svc, prisma } = build(); // every lookup returns null: the ids belong to someone else
    const task = await svc.create('t1', { department: 'Support', title: 'x', conversationId: 'foreign-conv', orderId: 'foreign-order', contactId: 'foreign-contact' });
    expect(prisma.internalTask.create.mock.calls[0][0].data).toMatchObject({ conversationId: undefined, orderId: undefined, contactId: undefined });
    expect(task.id).toBe('new');
  });
  it('a failing ownership lookup does not block creating the task', async () => {
    const { svc, prisma } = build();
    prisma.conversation.findFirst.mockRejectedValue(new Error('db'));
    await expect(svc.create('t1', { department: 'Support', title: 'x', conversationId: 'c1' })).resolves.toBeDefined();
  });
});

describe('InternalTasksController authorization', () => {
  const reflector = new Reflector();
  const rolesOf = (m: keyof InternalTasksController) => reflector.get<UserRole[]>(ROLES_KEY, InternalTasksController.prototype[m]);
  it('changing status and assigning require at least an agent (viewers are read-only)', () => {
    expect(rolesOf('updateStatus')).toEqual([UserRole.AGENT]);
    expect(rolesOf('assign')).toEqual([UserRole.AGENT]);
  });
  it('reading stays open to signed-in members', () => {
    expect(rolesOf('findAll')).toBeUndefined();
    expect(rolesOf('findOne')).toBeUndefined();
  });
});
