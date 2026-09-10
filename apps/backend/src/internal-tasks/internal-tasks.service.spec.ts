import { NotFoundException } from '@nestjs/common';
import { InternalTasksService } from './internal-tasks.service';

function buildPrismaMock() {
  return {
    team: { findFirst: jest.fn() },
    teamMember: { findMany: jest.fn() },
    user: { findMany: jest.fn(), findFirst: jest.fn() },
    internalTask: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  };
}

function buildDeps() {
  return {
    prisma: buildPrismaMock(),
    notifications: { notifyUser: jest.fn().mockResolvedValue(null) },
  };
}

function buildService(deps: ReturnType<typeof buildDeps>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new InternalTasksService(deps.prisma as any, deps.notifications as any);
}

describe('InternalTasksService', () => {
  describe('create', () => {
    it('matches department against Team.name case-insensitively and notifies team members', async () => {
      const deps = buildDeps();
      deps.prisma.team.findFirst.mockResolvedValue({ id: 'team-1', name: 'Design' });
      deps.prisma.internalTask.create.mockResolvedValue({
        id: 'task-1', title: 'Forward artwork', description: 'details', priority: 'NORMAL',
        assignedTeamId: 'team-1', conversationId: 'conv-1', orderId: null,
      });
      deps.prisma.teamMember.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);
      const service = buildService(deps);

      const task = await service.create('t1', { department: 'design', title: 'Forward artwork', description: 'details', conversationId: 'conv-1' });

      expect(deps.prisma.team.findFirst).toHaveBeenCalledWith({ where: { tenantId: 't1', name: { equals: 'design', mode: 'insensitive' } } });
      expect(deps.prisma.internalTask.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ assignedTeamId: 'team-1' }) }));
      expect(deps.notifications.notifyUser).toHaveBeenCalledTimes(2);
      expect(task.id).toBe('task-1');
    });

    it('falls back to notifying all tenant ADMINs when no team matches the department', async () => {
      const deps = buildDeps();
      deps.prisma.team.findFirst.mockResolvedValue(null);
      deps.prisma.internalTask.create.mockResolvedValue({
        id: 'task-2', title: 'Random request', description: null, priority: 'NORMAL',
        assignedTeamId: null, conversationId: null, orderId: null,
      });
      deps.prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
      const service = buildService(deps);

      await service.create('t1', { department: 'Nonexistent Team', title: 'Random request', description: 'details' });

      expect(deps.prisma.user.findMany).toHaveBeenCalledWith({ where: { tenantId: 't1', isActive: true, role: 'ADMIN' }, select: { id: true } });
      expect(deps.notifications.notifyUser).toHaveBeenCalledWith('admin-1', 't1', expect.objectContaining({ type: 'TASK_ASSIGNED' }));
    });

    it('still creates the task even if notification fails', async () => {
      const deps = buildDeps();
      deps.prisma.team.findFirst.mockResolvedValue(null);
      deps.prisma.internalTask.create.mockResolvedValue({ id: 'task-3', title: 't', description: null, priority: 'NORMAL', assignedTeamId: null, conversationId: null, orderId: null });
      deps.prisma.user.findMany.mockRejectedValue(new Error('db down'));
      const service = buildService(deps);

      const task = await service.create('t1', { department: 'X', title: 't', description: 'd' });

      expect(task.id).toBe('task-3');
    });
  });

  describe('resolveByOrderId', () => {
    it('resolves the open task linked to the order', async () => {
      const deps = buildDeps();
      deps.prisma.internalTask.findFirst.mockResolvedValue({ id: 'task-1' });
      deps.prisma.internalTask.update.mockResolvedValue({ id: 'task-1', status: 'DONE' });
      const service = buildService(deps);

      await service.resolveByOrderId('t1', 'order-1', 'user-1', 'DONE');

      expect(deps.prisma.internalTask.findFirst).toHaveBeenCalledWith({
        where: { tenantId: 't1', orderId: 'order-1', status: { in: ['OPEN', 'IN_PROGRESS'] } },
        orderBy: { createdAt: 'desc' },
      });
      expect(deps.prisma.internalTask.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'task-1' } }));
    });

    it('no-ops when there is no open task for the order', async () => {
      const deps = buildDeps();
      deps.prisma.internalTask.findFirst.mockResolvedValue(null);
      const service = buildService(deps);

      await expect(service.resolveByOrderId('t1', 'order-1', 'user-1', 'CANCELLED')).resolves.toBeUndefined();
      expect(deps.prisma.internalTask.update).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when the task does not exist for this tenant', async () => {
      const deps = buildDeps();
      deps.prisma.internalTask.findFirst.mockResolvedValue(null);
      const service = buildService(deps);

      await expect(service.findOne('t1', 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
