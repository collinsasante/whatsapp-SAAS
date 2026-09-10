import { LeadsService } from '../../leads/leads.service';
import { ToolDefinition, ToolExecutionContext } from './tool-registry.types';

/**
 * Verz-AI unification, Phase B: lets the agent qualify the lead it's mid-conversation
 * with, on demand -- e.g. right after a customer states quantity + timeline, before
 * deciding whether to push for checkout or hand off to a human. Always runs a fresh
 * scoring pass (LeadsService.scoreConversation force:true) rather than returning a
 * throttled/stale value, since an explicit ask deserves a current answer. Returns only
 * staff-safe summary fields -- reasoningSummary is intentionally withheld from the tool
 * result so it can never leak into a customer-facing reply; it's exposed to staff only
 * via the Lead read API / Inbox UI.
 */
export function buildLeadTools(leads: LeadsService): ToolDefinition[] {
  return [
    {
      def: {
        name: 'qualify_lead',
        description: 'Assess how promising this conversation is as a sales lead right now, based on everything said so far and any past orders. Use this after the customer has given you enough signal (e.g. a quantity, a deadline, a budget mention) to judge urgency and buying intent -- not on every message. The result is for your own internal judgement, never to be read back to the customer.',
        parameters: { type: 'object', properties: {} },
      },
      execute: async (ctx: ToolExecutionContext) => {
        const lead = await leads.scoreConversation(ctx.tenantId, ctx.conversationId, ctx.contactId, { force: true });
        if (!lead) return { error: 'Could not qualify this lead right now' };
        return {
          score: lead.score,
          status: lead.status,
          intent: lead.intent,
          urgencySignal: lead.urgencySignal,
          budgetSignal: lead.budgetSignal,
          productInterest: lead.productInterest,
          recommendedNextAction: lead.recommendedNextAction,
        };
      },
    },
  ];
}
