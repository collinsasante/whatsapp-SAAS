/**
 * Verz-AI unification, Phase E: the v2 pipeline is only ever reached for
 * commerceEnabled=false tenants (checked before the verz_ai_v2 flag,
 * unconditionally -- see messages.service.ts's generateAiReply), so it
 * structurally never has products/orders to offer tools for. create_internal_task
 * is the one genuinely tenant-agnostic capability -- it's what turns "someone
 * will follow up" from a lie into a real notification for any business type,
 * commerce or not. remember_conversation_facts has no customer-visible side
 * effect, so it's safe even before a human has reviewed a SUGGESTION-mode reply.
 * Catalogue/order tools and qualify_lead stay commerce-only (qualify_lead is a
 * sales-lead concept already gated on commerceEnabled for background scoring).
 *
 * Verz-AI unification, Phase N: set_pending_action/clear_pending_action have no
 * customer-visible effect either (same category as remember_conversation_facts),
 * so non-commerce tenants get confirmation-tracking too -- "okay" after "should
 * I connect you with someone about that?" needs resolving here just as much.
 */
const NON_COMMERCE_V2_TOOL_NAMES = ['create_internal_task', 'remember_conversation_facts', 'set_pending_action', 'clear_pending_action'];
const NON_COMMERCE_V2_READ_ONLY_TOOL_NAMES = ['remember_conversation_facts', 'set_pending_action', 'clear_pending_action'];

export function resolveToolNames(opts: { readOnlyTools: boolean }): string[] {
  return opts.readOnlyTools ? NON_COMMERCE_V2_READ_ONLY_TOOL_NAMES : NON_COMMERCE_V2_TOOL_NAMES;
}
