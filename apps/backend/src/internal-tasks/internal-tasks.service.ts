import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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

const DEFAULT_TASK_LIMIT = 200;
const MAX_TASK_LIMIT = 500;

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
    // Tasks are created by the AI's tools, whose arguments come from a model and so cannot be trusted to name only
    // this workspace's records. A reference to a conversation, order or contact in another workspace is dropped.
    const [conversationId, orderId, contactId] = await Promise.all([
      this.ownedId(() => input.conversationId && this.prisma.conversation.findFirst({ where: { id: input.conversationId, tenantId }, select: { id: true } })),
      this.ownedId(() => input.orderId && this.prisma.order.findFirst({ where: { id: input.orderId, tenantId }, select: { id: true } })),
      this.ownedId(() => input.contactId && this.prisma.contact.findFirst({ where: { id: input.contactId, tenantId }, select: { id: true } })),
    ]);
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
        conversationId,
        orderId,
        contactId,
        createdById: input.createdById ?? null,
      },
    });

    await this.notifyForTask(tenantId, task).catch((err) =>
      this.logger.warn(`Failed to notify for task ${task.id}: ${String(err)}`),
    );

    return task;
  }

  /** Returns the id when the record exists in this workspace, otherwise undefined (never throws, never links across tenants). */
  private async ownedId(lookup: () => unknown): Promise<string | undefined> {
    try {
      const row = (await lookup()) as { id: string } | null | false | undefined | '';
      return row ? row.id : undefined;
    } catch {
      return undefined;
    }
  }

  async findAll(tenantId: string, filters?: { status?: string; department?: string; assigneeId?: string; limit?: number }) {
    if (filters?.status && !(Object.values(TaskStatus) as string[]).includes(filters.status)) {
      throw new BadRequestException(`Status must be one of: ${Object.values(TaskStatus).join(', ')}.`);
    }
    const limit = Math.min(Math.max(Math.floor(filters?.limit ?? DEFAULT_TASK_LIMIT), 1), MAX_TASK_LIMIT);
    return this.prisma.internalTask.findMany({
      where: {
        tenantId,
        ...(filters?.status && { status: filters.status as TaskStatus }),
        ...(filters?.department && { department: { equals: filters.department, mode: 'insensitive' } }),
        ...(filters?.assigneeId && { assigneeId: filters.assigneeId }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  }

  async findOne(tenantId: string, id: string) {
    const task = await this.prisma.internalTask.findFirst({ where: { id, tenantId } });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async updateStatus(tenantId: string, id: string, status: TaskStatus, resolvedById?: string) {
    const task = await this.findOne(tenantId, id);
    if (task.status === status) return task; // idempotent: a repeat must not re-stamp who/when it was resolved
    const isTerminal = status === TaskStatus.DONE || status === TaskStatus.CANCELLED;
    return this.prisma.internalTask.update({
      where: { id },
      data: {
        status,
        // Resolved: record who and when. Reopened: clear them, otherwise an open task still claims to be resolved.
        ...(isTerminal ? { resolvedAt: new Date(), resolvedById: resolvedById ?? null } : { resolvedAt: null, resolvedById: null }),
      },
    });
  }

  async assign(tenantId: string, id: string, assigneeId: string, actor?: { userId: string; role?: string }) {
    await this.findOne(tenantId, id);
    // Handing a task to someone else is an admin action; anyone who can work tasks may take one for themselves.
    const isAdmin = actor?.role === 'ADMIN' || actor?.role === 'SUPER_ADMIN';
    if (actor && assigneeId !== actor.userId && !isAdmin) {
      throw new ForbiddenException('You can only assign tasks to yourself. Ask an admin to assign them to someone else.');
    }
    const user = await this.prisma.user.findFirst({ where: { id: assigneeId, tenantId, isActive: true } });
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
