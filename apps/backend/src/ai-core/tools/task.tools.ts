import { TaskPriority } from '@prisma/client';
import { InternalTasksService } from '../../internal-tasks/internal-tasks.service';
import { OrdersService } from '../../commerce/orders/orders.service';
import { ToolDefinition, ToolExecutionContext } from './tool-registry.types';
import { argText } from './tool-args.util';

const VALID_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

/** Migrated verbatim from CommerceAiService.executeTool's create_internal_task case. Order
 * linkage is best-effort (a task can exist without an order), matching the original. */
export function buildTaskTools(internalTasks: InternalTasksService, orders: OrdersService): ToolDefinition[] {
  return [
    {
      stateChanging: true,
      def: {
        name: 'create_internal_task',
        description: 'Create an internal task for a human team to handle something you cannot resolve yourself -- e.g. forwarding artwork, a special request, a complaint needing follow-up. Use this instead of just telling the customer someone will help; this actually notifies the right team.',
        parameters: {
          type: 'object',
          properties: {
            department: { type: 'string', description: 'Which team should handle this, e.g. "Design", "Sales", "Orders". Match this business\'s actual team names if you know them from context; otherwise your best guess for the type of work.' },
            title: { type: 'string', description: 'Short summary, e.g. "Forward custom artwork request"' },
            description: { type: 'string', description: 'Full detail a team member needs, including anything specific the customer said.' },
            priority: { type: 'string', enum: [...VALID_PRIORITIES] },
          },
          required: ['department', 'title', 'description'],
        },
      },
      execute: async (ctx: ToolExecutionContext, args) => {
        const department = argText(args, 'department', 80);
        const title = argText(args, 'title', 200);
        const description = argText(args, 'description', 4000);
        if (!department || !title || !description) return { error: 'department, title, and description are required' };
        const priorityArg = argText(args, 'priority', 20)?.toUpperCase();
        const priority = (VALID_PRIORITIES as readonly string[]).includes(priorityArg ?? '')
          ? (priorityArg as TaskPriority)
          : TaskPriority.NORMAL;
        const order = await orders.findMostRecentForConversation(ctx.tenantId, ctx.conversationId).catch(() => null);
        const task = await internalTasks.create(ctx.tenantId, {
          department,
          title,
          description,
          priority,
          conversationId: ctx.conversationId,
          contactId: ctx.contactId,
          orderId: order?.id,
          createdById: null,
        });
        return { taskId: task.id, status: task.status, assignedTo: task.assignedTeamId ? department : 'no matching team -- notified admins' };
      },
    },
  ];
}
