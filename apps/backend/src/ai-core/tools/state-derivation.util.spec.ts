import { deriveStateFromToolTrace, mergeAiState } from './state-derivation.util';
import { ToolCallTrace } from './tool-calling.service';

function trace(name: string, args: Record<string, unknown>, result: unknown): ToolCallTrace {
  return { name, args, result } as ToolCallTrace;
}

describe('deriveStateFromToolTrace -- Verz-AI unification, Phase N pendingAction clearing', () => {
  it('clears pendingAction when add_item_to_order actually succeeds this turn', () => {
    const patch = deriveStateFromToolTrace([
      trace('add_item_to_order', { productId: 'p1', quantity: 12 }, { orderId: 'o1', items: [] }),
    ]);

    expect(patch.pendingAction).toBeNull();
  });

  it('clears pendingAction when submit_order_for_payment actually succeeds this turn', () => {
    const patch = deriveStateFromToolTrace([
      trace('submit_order_for_payment', {}, { orderId: 'o1', paymentLink: 'https://pay' }),
    ]);

    expect(patch.pendingAction).toBeNull();
  });

  it('does not clear pendingAction when add_item_to_order fails', () => {
    const patch = deriveStateFromToolTrace([
      trace('add_item_to_order', { productId: 'p1' }, { error: 'not found' }),
    ]);

    expect(patch.pendingAction).toBeUndefined();
  });

  it('leaves pendingAction untouched for read-only tool calls', () => {
    const patch = deriveStateFromToolTrace([
      trace('get_current_order', {}, { orderId: 'o1', items: [] }),
      trace('search_products', { query: 'bag' }, [{ id: 'p1' }]),
    ]);

    expect(patch.pendingAction).toBeUndefined();
  });

  it('still derives selectedProductId/activeOrderId alongside a pendingAction clear', () => {
    const patch = deriveStateFromToolTrace([
      trace('add_item_to_order', { productId: 'p1' }, { orderId: 'o1', items: [] }),
    ]);

    expect(patch.pendingAction).toBeNull();
    expect(patch.activeOrderId).toBe('o1');
  });
});

describe('mergeAiState -- pendingAction merge/clear semantics', () => {
  const existingWithPending = {
    pendingAction: { type: 'ADD_TO_ORDER', description: 'Add 12 packs of Size 1', askedAt: '2026-01-01T00:00:00.000Z' },
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('null in the patch clears an existing pendingAction', () => {
    const merged = mergeAiState(existingWithPending, { pendingAction: null });
    expect(merged.pendingAction).toBeUndefined();
  });

  it('a new pendingAction in the patch overwrites the existing one', () => {
    const merged = mergeAiState(existingWithPending, {
      pendingAction: { type: 'CHECKOUT', description: 'Confirm checkout', askedAt: '2026-01-02T00:00:00.000Z' },
    });
    expect(merged.pendingAction?.type).toBe('CHECKOUT');
  });

  it('omitting pendingAction from the patch leaves the existing one alone', () => {
    const merged = mergeAiState(existingWithPending, { currentIntent: 'buy bags' });
    expect(merged.pendingAction?.type).toBe('ADD_TO_ORDER');
  });
});
