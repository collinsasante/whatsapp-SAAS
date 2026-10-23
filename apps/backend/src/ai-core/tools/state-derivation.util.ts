import { ToolCallTrace } from './tool-calling.service';

export interface AiState {
  currentIntent?: string;
  knownFacts?: Record<string, string>;
  missingInfo?: string[];
  selectedProductId?: string;
  activeOrderId?: string;
  lastTopic?: string;
  updatedAt: string;
}

const MAX_KNOWN_FACTS = 8;

/**
 * Verz-AI unification, Phase F: deterministic half of state tracking -- reads
 * the toolTrace both orchestrators already produce/return and pulls out
 * selectedProductId/activeOrderId without any model involvement, so those two
 * fields are never dependent on the model remembering to call
 * remember_conversation_facts. Unknown/irrelevant tool calls are ignored.
 */
export function deriveStateFromToolTrace(trace: ToolCallTrace[]): Partial<AiState> {
  const patch: Partial<AiState> = {};

  for (const call of trace) {
    const result = call.result as Record<string, unknown> | null;
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
export function mergeAiState(existing: unknown, patch: Partial<AiState>): AiState {
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
    updatedAt: new Date().toISOString(),
  };
}
