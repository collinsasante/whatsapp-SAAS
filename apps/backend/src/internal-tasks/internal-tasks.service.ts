import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TaskPriority, TaskStatus, NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface CreateTaskInput {
  department: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  conversationId?: string;
  orderId?: string;
  contactId?: string;
  createdById?: string | null;
}

/**
 * Verz-AI Phase 2b: gives the platform a real way to hand work to a human team --
 * previously the AI (and the order-approval flow) could only tell a customer "a team
 * member will help," with nothing structurally happening. `department` is free text
 * matched case-insensitively against Team.name (reusing the existing Team model, not a
 * new department concept) -- Teams are already tenant-configurable via the /manage page.
 * If no team matches, or a task isn't linked to a team at all, every tenant ADMIN gets
 * notified instead, so a task is never silently unnoticed.
 */
@Injectable()
export class InternalTasksService {
  private readonly logger = new Logger(InternalTasksService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async create(tenantId: string, input: CreateTaskInput) {
    const matchedTeam = await this.prisma.team.findFirst({
      where: { tenantId, name: { equals: input.department, mode: 'insensitive' } },
    });

    const task = await this.prisma.internalTask.create({
      data: {
        tenantId,
        department: input.department,
        assignedTeamId: matchedTeam?.id,
        title: input.title,
        description: input.description,
        priority: input.priority ?? TaskPriority.NORMAL,
        conversationId: input.conversationId,
        orderId: input.orderId,
        contactId: input.contactId,
        createdById: input.createdById ?? null,
      },
    });

    await this.notifyForTask(tenantId, task).catch((err) =>
      this.logger.warn(`Failed to notify for task ${task.id}: ${String(err)}`),
    );

    return task;
  }

  findAll(tenantId: string, filters?: { status?: TaskStatus; department?: string; assigneeId?: string }) {
    return this.prisma.internalTask.findMany({
      where: {
        tenantId,
        ...(filters?.status && { status: filters.status }),
        ...(filters?.department && { department: { equals: filters.department, mode: 'insensitive' } }),
        ...(filters?.assigneeId && { assigneeId: filters.assigneeId }),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const task = await this.prisma.internalTask.findFirst({ where: { id, tenantId } });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async updateStatus(tenantId: string, id: string, status: TaskStatus, resolvedById?: string) {
    await this.findOne(tenantId, id);
    const isTerminal = status === TaskStatus.DONE || status === TaskStatus.CANCELLED;
    return this.prisma.internalTask.update({
      where: { id },
      data: {
        status,
        ...(isTerminal && { resolvedAt: new Date(), resolvedById: resolvedById ?? null }),
      },
    });
  }

  async assign(tenantId: string, id: string, assigneeId: string) {
    await this.findOne(tenantId, id);
    const user = await this.prisma.user.findFirst({ where: { id: assigneeId, tenantId } });
    if (!user) throw new NotFoundException('User not found');
    return this.prisma.internalTask.update({ where: { id }, data: { assigneeId } });
  }

  /** Used by OrdersService's approve/reject actions so it never needs to track a task
   * id -- no-ops (logs+swallows) if no open task exists for the order, which is fine:
   * an order can be approved/rejected even if its task was already resolved or missing. */
  async resolveByOrderId(tenantId: string, orderId: string, resolvedById: string, status: 'DONE' | 'CANCELLED') {
    const task = await this.prisma.internalTask.findFirst({
      where: { tenantId, orderId, status: { in: [TaskStatus.OPEN, TaskStatus.IN_PROGRESS] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!task) return;
    await this.updateStatus(tenantId, task.id, TaskStatus[status], resolvedById);
  }

  private async notifyForTask(tenantId: string, task: { id: string; title: string; description: string | null; priority: TaskPriority; assignedTeamId: string | null; conversationId: string | null; orderId: string | null }) {
    const link = task.conversationId ? `/inbox?c=${task.conversationId}` : task.orderId ? '/commerce/orders' : '/tasks';

    let recipientIds: string[];
    if (task.assignedTeamId) {
      const members = await this.prisma.teamMember.findMany({ where: { teamId: task.assignedTeamId }, select: { userId: true } });
      recipientIds = members.map((m) => m.userId);
    } else {
      const admins = await this.prisma.user.findMany({ where: { tenantId, isActive: true, role: 'ADMIN' }, select: { id: true } });
      recipientIds = admins.map((a) => a.id);
    }

    await Promise.all(
      recipientIds.map((userId) =>
        this.notifications.notifyUser(userId, tenantId, {
          type: NotificationType.TASK_ASSIGNED,
          title: task.title,
          body: task.description ?? 'A new task needs attention.',
          link,
          metadata: { taskId: task.id, priority: task.priority },
        }),
      ),
    );
  }
}
