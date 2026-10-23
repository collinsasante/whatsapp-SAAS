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

/** Verz-AI unification, Phase G: a tool's only output channel used to be its
 * text result fed back to the model -- no way for a tool to also trigger a
 * real side effect like sending a WhatsApp media message. A tool may now
 * return this envelope shape instead of a bare object; ToolCallingService
 * detects it and separates the two. Existing tools are unaffected -- a bare
 * object return is still valid and has no side effect, exactly as before. */
export interface ToolSideEffect {
  type: 'send_media';
  mediaUrl: string;
  mediaType: 'IMAGE';
  caption?: string;
  productId?: string;
}

export interface ToolResultEnvelope {
  forModel: unknown;
  sideEffect?: ToolSideEffect;
}

export function isToolResultEnvelope(value: unknown): value is ToolResultEnvelope {
  return !!value && typeof value === 'object' && 'forModel' in value;
}
