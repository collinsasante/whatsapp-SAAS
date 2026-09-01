import { crossCheckOrderCapture, assertNoSuccessfulPurchase, assertToolWasCalled, fuzzyMatchProduct } from './evaluation-checks.util';

describe('crossCheckOrderCapture', () => {
  it('passes when a successful add_item_to_order call has a matching OrderItem', () => {
    const trace = [{ name: 'add_item_to_order', args: { productId: 'p1', quantity: 2 }, result: { orderId: 'o1' } }];
    const items = [{ productId: 'p1', quantity: 2 }];
    expect(crossCheckOrderCapture(trace, items)).toEqual({ pass: true, reasons: [] });
  });

  it('fails when the tool claimed success but no matching OrderItem exists', () => {
    const trace = [{ name: 'add_item_to_order', args: { productId: 'p1', quantity: 2 }, result: { orderId: 'o1' } }];
    const items: { productId: string; quantity: number }[] = [];
    const result = crossCheckOrderCapture(trace, items);
    expect(result.pass).toBe(false);
    expect(result.reasons[0]).toMatch(/no matching OrderItem exists/);
  });

  it('ignores a rejected add (tool returned an error) -- no OrderItem is correctly expected', () => {
    const trace = [{ name: 'add_item_to_order', args: { productId: 'p1', quantity: 2 }, result: { error: 'out of stock' } }];
    expect(crossCheckOrderCapture(trace, [])).toEqual({ pass: true, reasons: [] });
  });

  it('ignores tool calls other than add_item_to_order', () => {
    const trace = [{ name: 'get_current_order', args: {}, result: {} }];
    expect(crossCheckOrderCapture(trace, [])).toEqual({ pass: true, reasons: [] });
  });

  it('fails on malformed args missing productId/quantity', () => {
    const trace = [{ name: 'add_item_to_order', args: {}, result: { orderId: 'o1' } }];
    const result = crossCheckOrderCapture(trace, []);
    expect(result.pass).toBe(false);
  });

  it('handles multiple add calls, matching each independently', () => {
    const trace = [
      { name: 'add_item_to_order', args: { productId: 'p1', quantity: 1 }, result: { orderId: 'o1' } },
      { name: 'add_item_to_order', args: { productId: 'p2', quantity: 3 }, result: { orderId: 'o1' } },
    ];
    const items = [{ productId: 'p1', quantity: 1 }, { productId: 'p2', quantity: 3 }];
    expect(crossCheckOrderCapture(trace, items)).toEqual({ pass: true, reasons: [] });
  });
});

describe('assertNoSuccessfulPurchase', () => {
  it('passes when no OrderItem exists for the product', () => {
    expect(assertNoSuccessfulPurchase('p1', []).pass).toBe(true);
  });

  it('fails when an OrderItem exists for the product', () => {
    const result = assertNoSuccessfulPurchase('p1', [{ productId: 'p1', quantity: 1 }]);
    expect(result.pass).toBe(false);
  });
});

describe('assertToolWasCalled', () => {
  it('passes when the tool appears in the trace', () => {
    const trace = [{ name: 'get_order_status', args: {}, result: {} }];
    expect(assertToolWasCalled(trace, 'get_order_status').pass).toBe(true);
  });

  it('fails when the tool never appears', () => {
    expect(assertToolWasCalled([], 'get_order_status').pass).toBe(false);
  });
});

describe('fuzzyMatchProduct', () => {
  const products = [
    { id: '1', name: 'Blue Denim Jacket', isActive: true },
    { id: '2', name: 'Red Sneakers', isActive: true },
  ];

  it('matches an exact name (case-insensitive)', () => {
    expect(fuzzyMatchProduct('blue denim jacket', products)?.id).toBe('1');
  });

  it('matches a substring of the real name', () => {
    expect(fuzzyMatchProduct('Denim Jacket', products)?.id).toBe('1');
  });

  it('matches when the claim is broader than the real name', () => {
    expect(fuzzyMatchProduct('Red Sneakers Size 10', products)?.id).toBe('2');
  });

  it('returns null for a genuinely nonexistent product', () => {
    expect(fuzzyMatchProduct('Titanium Deluxe Widget', products)).toBeNull();
  });

  it('returns null for an empty claim', () => {
    expect(fuzzyMatchProduct('', products)).toBeNull();
  });
});
