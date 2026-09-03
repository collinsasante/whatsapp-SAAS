import { ChatToolDef } from '../providers/ai-provider.interface';

/** Everything a tool handler needs to act, without the model ever supplying these
 * values itself -- tenantId/conversationId/contactId always come from the real
 * inbound message, never from model-provided arguments. */
export interface ToolExecutionContext {
  tenantId: string;
  conversationId: string;
  contactId: string;
  customerPhone: string;
  /** Set only by the AI evaluation harness -- skips the real Paystack call in
   * submit_order_for_payment while exercising identical state-transition logic. */
  dryRunPayment?: boolean;
}

export interface ToolDefinition {
  def: ChatToolDef;
  execute: (ctx: ToolExecutionContext, args: Record<string, unknown>) => Promise<unknown>;
}
