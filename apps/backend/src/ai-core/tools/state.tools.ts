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
  ];
}
