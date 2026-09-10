import { ToolCallTrace } from './tool-calling.service';

/**
 * Verz-AI unification, Phase N: what the AI just proposed to the customer and is
 * awaiting a yes/no on -- e.g. "Shall I add 12 packs of Size 1?" / "okay". Without
 * this, a bare confirmation word had nothing to resolve against except raw chat
 * history, entirely left to the model's own judgement turn to turn. `type` is a
 * loose free-text label (not a rigid enum the model must match exactly) --
 * ADD_TO_ORDER/REMOVE_FROM_ORDER/CHECKOUT/CANCEL_ORDER/DELIVERY_METHOD/CONFIRM_ADDRESS/
 * QUOTATION/OTHER are suggested values in the tool description, not enforced ones.
 */
export interface PendingAction {
  type: string;
  description: string;
  askedAt: string;
}

export interface AiState {
  currentIntent?: string;
  knownFacts?: Record<string, string>;
  missingInfo?: string[];
  selectedProductId?: string;
  activeOrderId?: string;
  lastTopic?: string;
  pendingAction?: PendingAction;
  updatedAt: string;
}

const MAX_KNOWN_FACTS = 8;

/** `pendingAction: null` is an explicit instruction to clear it; `undefined`
 * (the default, omitted) means "leave whatever's there alone." Same convention
 * used by AiStatePatch generally where a field needs to be clearable, not just
 * mergeable -- see mergeAiState. */
export type AiStatePatch = Partial<Omit<AiState, 'pendingAction'>> & { pendingAction?: PendingAction | null };

/**
 * Verz-AI unification, Phase F: deterministic half of state tracking -- reads
 * the toolTrace both orchestrators already produce/return and pulls out
 * selectedProductId/activeOrderId without any model involvement, so those two
 * fields are never dependent on the model remembering to call
 * remember_conversation_facts. Unknown/irrelevant tool calls are ignored.
 *
 * Verz-AI unification, Phase N: also clears pendingAction whenever a
 * state-changing commerce tool actually ran this turn -- whatever was proposed
 * and awaiting confirmation has now been acted on (or superseded by a new tool
 * call), so it's no longer "pending." This is a deliberate deterministic
 * safety net on top of the model's own bookkeeping (set_pending_action /
 * clear_pending_action in state.tools.ts): even if the model forgets to clear
 * it explicitly, a real write action clears it anyway.
 */
export function deriveStateFromToolTrace(trace: ToolCallTrace[]): AiStatePatch {
  const patch: AiStatePatch = {};
  const WRITE_TOOL_NAMES = new Set(['add_item_to_order', 'submit_order_for_payment']);

  for (const call of trace) {
    const result = call.result as Record<string, unknown> | null;
    if (WRITE_TOOL_NAMES.has(call.name) && result && typeof result === 'object' && !('error' in result)) {
      patch.pendingAction = null;
    }
    if (!result || typeof result !== 'object' || 'error' in result) continue;

    if (call.name === 'get_product_details' && typeof result['id'] === 'string') {
      patch.selectedProductId = result['id'];
    }
    if (call.name === 'send_product_image' && typeof call.args === 'object' && call.args) {
      const productId = (call.args as Record<string, unknown>)['productId'];
      if (typeof productId === 'string') patch.selectedProductId = productId;
    }
    if (
      (call.name === 'add_item_to_order' || call.name === 'get_current_order' || call.name === 'submit_order_for_payment')
      && typeof result['orderId'] === 'string'
    ) {
      patch.activeOrderId = result['orderId'];
    }
  }

  return patch;
}

/** Shallow-merges a patch into existing state, bounding knownFacts growth over a long conversation. */
export function mergeAiState(existing: unknown, patch: AiStatePatch): AiState {
  const base = (existing && typeof existing === 'object' ? existing : {}) as Partial<AiState>;
  const mergedFacts = { ...(base.knownFacts ?? {}), ...(patch.knownFacts ?? {}) };
  const factKeys = Object.keys(mergedFacts);
  const trimmedFacts = factKeys.length > MAX_KNOWN_FACTS
    ? Object.fromEntries(factKeys.slice(factKeys.length - MAX_KNOWN_FACTS).map((k) => [k, mergedFacts[k]]))
    : mergedFacts;

  return {
    currentIntent: patch.currentIntent ?? base.currentIntent,
    knownFacts: Object.keys(trimmedFacts).length > 0 ? trimmedFacts : undefined,
    missingInfo: patch.missingInfo ?? base.missingInfo,
    selectedProductId: patch.selectedProductId ?? base.selectedProductId,
    activeOrderId: patch.activeOrderId ?? base.activeOrderId,
    lastTopic: patch.lastTopic ?? base.lastTopic,
    pendingAction: patch.pendingAction === null ? undefined : (patch.pendingAction ?? base.pendingAction),
    updatedAt: new Date().toISOString(),
  };
}
