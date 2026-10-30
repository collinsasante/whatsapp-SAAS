import { detectHumanRequest } from '../ai-core/pipeline/escalation-detector.util';

/**
 * Rapid-fire messages. A customer who types "hi", "i want a shirt", "the red one" in three separate messages used to get three
 * replies, each written with only the messages before it; the first two are answers to half a thought. Turns for one conversation
 * already run one after another, so when a newer turn is waiting behind the one that is running, that newer turn will read the whole
 * burst and answer it once. This decides when it is safe for the running turn to stand aside.
 *
 * Skipping is only ever safe when nothing is lost by it, so the answers below are deliberately conservative.
 */

/**
 * Tools that only look something up or keep the AI's own notes. A turn that used nothing else changed nothing the customer or the
 * business can see, so its reply can be dropped without leaving anything half-done. Everything else is excluded on purpose:
 * add_item_to_order, submit_order_for_payment, arrange_delivery, create_internal_task and send_product_image change or send
 * something; set_pending_action/clear_pending_action record a question the AI just asked, so dropping the reply would leave it
 * waiting for an answer to a question the customer never saw.
 */
export const LOOKUP_ONLY_TOOLS: readonly string[] = [
  'search_products',
  'get_product_details',
  'get_order_status',
  'get_current_order',
  'check_delivery_info',
  'remember_conversation_facts',
  'qualify_lead',
];

export function usedOnlyLookups(toolTrace: ReadonlyArray<{ name: string }> | undefined): boolean {
  return (toolTrace ?? []).every((t) => LOOKUP_ONLY_TOOLS.includes(t.name));
}

/**
 * Before the model is called: nothing has been spent and nothing has happened, so a turn can stand aside whenever a newer turn is
 * queued. The one exception is a customer asking for a person: that handoff must happen for the message that asked for it, however
 * many messages follow.
 */
export function shouldSkipBeforeGeneration(input: { customerMessage: string; newerTurnQueued: boolean }): boolean {
  return input.newerTurnQueued && !detectHumanRequest(input.customerMessage);
}

/**
 * After the model has answered, before the reply is sent. The model call is already paid for, so the reply is dropped only if that is
 * harmless: a newer turn is queued, the turn did not decide to hand the conversation to a person, and it used lookups only.
 */
export function shouldSkipBeforeSending(input: {
  newerTurnQueued: boolean;
  shouldEscalate: boolean;
  toolTrace: ReadonlyArray<{ name: string }> | undefined;
  hasMediaToSend: boolean;
}): boolean {
  return input.newerTurnQueued && !input.shouldEscalate && !input.hasMediaToSend && usedOnlyLookups(input.toolTrace);
}
