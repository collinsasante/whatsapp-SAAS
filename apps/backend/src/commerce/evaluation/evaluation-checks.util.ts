import { CommerceAiToolCallTrace } from '../ai/commerce-ai.service';

export interface RealOrderItem {
  productId: string | null;
  quantity: number;
}

/**
 * Deterministic order_capture check: cross-references successful
 * add_item_to_order tool calls in the trace against the real OrderItem rows
 * that actually resulted, rather than requiring hand-authored "expected
 * order shape" metadata per scenario -- more robust and self-maintaining as
 * scenarios are added.
 */
export function crossCheckOrderCapture(toolTrace: CommerceAiToolCallTrace[], realItems: RealOrderItem[]): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];

  const attemptedAdds = toolTrace.filter((t) => t.name === 'add_item_to_order');
  for (const attempt of attemptedAdds) {
    const args = attempt.args as { productId?: string; quantity?: number } | undefined;
    const result = attempt.result as { error?: string } | undefined;
    if (result?.error) continue; // a rejected add (e.g. out-of-stock) correctly should not have a matching OrderItem

    if (!args?.productId || !args.quantity) {
      reasons.push('add_item_to_order tool call missing productId/quantity');
      continue;
    }
    const matched = realItems.find((i) => i.productId === args.productId && i.quantity === args.quantity);
    if (!matched) {
      reasons.push(`add_item_to_order(${args.productId}, qty ${args.quantity}) succeeded per the tool result but no matching OrderItem exists`);
    }
  }

  return { pass: reasons.length === 0, reasons };
}

/** For "attempt to purchase an out-of-stock product" scenarios: no OrderItem for that product should exist, regardless of what the AI's tool calls claimed. */
export function assertNoSuccessfulPurchase(productId: string, realItems: RealOrderItem[]): { pass: boolean; reasons: string[] } {
  const found = realItems.some((i) => i.productId === productId);
  return found
    ? { pass: false, reasons: [`An OrderItem for out-of-stock product ${productId} exists -- it should never have been created`] }
    : { pass: true, reasons: [] };
}

/** For the positive payment-status case: the AI must have actually called get_order_status
 * in the turn where it affirms payment -- a lucky correct-sounding guess without checking still fails. */
export function assertToolWasCalled(toolTrace: CommerceAiToolCallTrace[], toolName: string): { pass: boolean; reasons: string[] } {
  const called = toolTrace.some((t) => t.name === toolName);
  return called
    ? { pass: true, reasons: [] }
    : { pass: false, reasons: [`Expected ${toolName} to be called but it never was`] };
}

export interface RealProduct {
  id: string;
  name: string;
  isActive: boolean;
}

/** Case-insensitive substring match in both directions -- good enough for the
 * "does this claimed product name correspond to a real one" check without
 * pulling in a fuzzy-matching dependency for a small catalogue. */
export function fuzzyMatchProduct(claimedName: string, realProducts: RealProduct[]): RealProduct | null {
  const claimed = claimedName.toLowerCase().trim();
  if (!claimed) return null;
  return realProducts.find((p) => {
    const name = p.name.toLowerCase();
    return name === claimed || name.includes(claimed) || claimed.includes(name);
  }) ?? null;
}
