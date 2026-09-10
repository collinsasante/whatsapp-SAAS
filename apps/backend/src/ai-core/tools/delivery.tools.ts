import { PrismaService } from '../../prisma/prisma.service';
import { InternalTasksService } from '../../internal-tasks/internal-tasks.service';
import { OrdersService } from '../../commerce/orders/orders.service';
import { ToolDefinition, ToolExecutionContext } from './tool-registry.types';

/**
 * Verz-AI unification, Phase Q: previously there was no delivery tool, schema field,
 * or table anywhere -- the AI's only move on a delivery question was a vague
 * "I've flagged it" with no real action behind it. No live courier API exists (no
 * Yango integration, no fee-calculation service), so the honest scope here is: let a
 * tenant describe their real delivery capability in their own words via
 * TenantSettings.deliveryEnabled/deliveryInfo, and make actually arranging a delivery
 * a real InternalTask a human executes -- same "make the vague sentence a real action"
 * pattern create_internal_task already established.
 */
export function buildDeliveryTools(prisma: PrismaService, internalTasks: InternalTasksService, orders: OrdersService): ToolDefinition[] {
  return [
    {
      def: {
        name: 'check_delivery_info',
        description: "Check whether this business offers delivery and what the business has said about it (methods, areas, typical fees). Call this whenever the customer asks about delivery, shipping, or whether something can be sent to them -- before answering, not from memory or assumption. If delivery is enabled but no location has been given yet, ask for their area/location next rather than guessing.",
        parameters: { type: 'object', properties: {} },
      },
      execute: async (ctx: ToolExecutionContext) => {
        const settings = await prisma.tenantSettings.findUnique({
          where: { tenantId: ctx.tenantId },
          select: { deliveryEnabled: true, deliveryInfo: true },
        });
        if (!settings?.deliveryEnabled) return { deliveryAvailable: false };
        return { deliveryAvailable: true, info: settings.deliveryInfo ?? null };
      },
    },
    {
      def: {
        name: 'arrange_delivery',
        description: "STATE-CHANGING, CUSTOMER-FACING COMMITMENT: creates a real internal task for the team to actually book/arrange this specific delivery. Only call this once you have the recipient's name, phone number, and delivery address/area, and the customer has confirmed they want delivery (and a method, if this business offers more than one). This does not happen automatically just because delivery is enabled -- calling this is what makes it a real, tracked request, so don't tell the customer delivery is arranged until after you've called this and it succeeds.",
        parameters: {
          type: 'object',
          properties: {
            recipientName: { type: 'string' },
            phone: { type: 'string' },
            address: { type: 'string', description: 'Delivery area/address as the customer gave it.' },
            method: { type: 'string', description: 'Delivery method if the customer chose one, e.g. "Yango". Optional.' },
            notes: { type: 'string', description: 'Anything else relevant, e.g. landmark, preferred time.' },
          },
          required: ['recipientName', 'phone', 'address'],
        },
      },
      execute: async (ctx: ToolExecutionContext, args) => {
        const recipientName = (args['recipientName'] as string | undefined)?.trim();
        const phone = (args['phone'] as string | undefined)?.trim();
        const address = (args['address'] as string | undefined)?.trim();
        if (!recipientName || !phone || !address) return { error: 'recipientName, phone, and address are required' };
        const method = (args['method'] as string | undefined)?.trim();
        const notes = (args['notes'] as string | undefined)?.trim();

        const order = await orders.findMostRecentForConversation(ctx.tenantId, ctx.conversationId).catch(() => null);
        const description = [
          `Recipient: ${recipientName}`,
          `Phone: ${phone}`,
          `Address: ${address}`,
          method ? `Method: ${method}` : null,
          notes ? `Notes: ${notes}` : null,
        ].filter(Boolean).join('\n');

        const task = await internalTasks.create(ctx.tenantId, {
          department: 'Delivery',
          title: `Arrange delivery for ${recipientName}`,
          description,
          conversationId: ctx.conversationId,
          contactId: ctx.contactId,
          orderId: order?.id,
        });
        return { taskId: task.id, status: task.status };
      },
    },
  ];
}
