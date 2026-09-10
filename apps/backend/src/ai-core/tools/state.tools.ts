import { ConversationStateService } from '../../conversations/conversation-state.service';
import { ToolDefinition, ToolExecutionContext } from './tool-registry.types';

/**
 * Verz-AI unification, Phase F: voluntary, model-driven half of state tracking
 * -- same "call when you've learned something worth keeping, not every turn"
 * pattern as qualify_lead. Never customer-visible (no side effect the customer
 * would notice), so it's safe to offer even in SUGGESTION mode.
 */
export function buildStateTools(state: ConversationStateService): ToolDefinition[] {
  return [
    {
      def: {
        name: 'remember_conversation_facts',
        description: "Save something worth remembering for the rest of this conversation -- e.g. what the customer is trying to do, a detail they gave you, or what's still missing before you can help them fully. Call this when you've just learned something durable, not on every message. This never sends anything to the customer; it's purely for your own memory across turns.",
        parameters: {
          type: 'object',
          properties: {
            currentIntent: { type: 'string', description: 'A short phrase for what the customer is trying to do right now, e.g. "order 100 branded paper bags"' },
            addKnownFacts: {
              type: 'object',
              description: 'Key facts to remember, e.g. {"quantity": "100", "size": "medium", "deliveryArea": "East Legon"}',
              additionalProperties: { type: 'string' },
            },
            missingInfo: { type: 'array', items: { type: 'string' }, description: 'What you still need from the customer to move forward, e.g. ["size", "delivery date"]' },
            lastTopic: { type: 'string', description: 'A short phrase for the topic to return to after answering an unrelated question, e.g. "the paper bag order"' },
          },
        },
      },
      execute: async (ctx: ToolExecutionContext, args) => {
        await state.mergeState(ctx.tenantId, ctx.conversationId, {
          currentIntent: args['currentIntent'] as string | undefined,
          knownFacts: args['addKnownFacts'] as Record<string, string> | undefined,
          missingInfo: args['missingInfo'] as string[] | undefined,
          lastTopic: args['lastTopic'] as string | undefined,
        });
        return { saved: true };
      },
    },
    {
      def: {
        name: 'set_pending_action',
        description: "Call this the moment you ask the customer a yes/no confirmation question -- e.g. \"Shall I add 12 packs of Size 1?\" or \"Let's do Yango, is that right?\". This is how a later bare reply like \"okay\"/\"yes\"/\"sure\" gets correctly understood as confirming THIS specific thing, instead of being ambiguous. Always call this in the SAME turn as the question, right before you send it. It gets cleared automatically once the corresponding action actually happens (e.g. the item gets added), or you can clear it yourself with clear_pending_action if the customer moves on to something else instead of answering.",
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'A short label for what kind of confirmation this is, e.g. ADD_TO_ORDER, REMOVE_FROM_ORDER, CHECKOUT, CANCEL_ORDER, DELIVERY_METHOD, CONFIRM_ADDRESS, QUOTATION, OTHER.' },
            description: { type: 'string', description: 'A short, specific restatement of exactly what you asked, e.g. "Add 12 packs of Size 1 Brown Paper Bag to the order" -- specific enough that a plain "yes" unambiguously means this.' },
          },
          required: ['type', 'description'],
        },
      },
      execute: async (ctx: ToolExecutionContext, args) => {
        await state.mergeState(ctx.tenantId, ctx.conversationId, {
          pendingAction: { type: String(args['type'] ?? 'OTHER'), description: String(args['description'] ?? ''), askedAt: new Date().toISOString() },
        });
        return { saved: true };
      },
    },
    {
      def: {
        name: 'clear_pending_action',
        description: "Call this if the customer clearly moves on without answering a pending yes/no question you asked (e.g. they change topic or ask something unrelated) -- so a later \"okay\" isn't wrongly matched back to the old question. You don't need to call this after the customer actually confirms and you act on it -- that's cleared automatically.",
        parameters: { type: 'object', properties: {} },
      },
      execute: async (ctx: ToolExecutionContext) => {
        await state.mergeState(ctx.tenantId, ctx.conversationId, { pendingAction: null });
        return { saved: true };
      },
    },
  ];
}
