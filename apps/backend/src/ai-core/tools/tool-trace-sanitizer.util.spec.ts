import { sanitizeToolTrace } from './tool-trace-sanitizer.util';
import { ToolCallTrace } from './tool-calling.service';

describe('sanitizeToolTrace -- second hardening pass, Section 2', () => {
  it('marks a call successful when the result has no error field', () => {
    const trace: ToolCallTrace[] = [{ name: 'search_products', args: { query: 'bag' }, result: [{ id: 'p1' }], durationMs: 42 }];

    const sanitized = sanitizeToolTrace(trace);

    expect(sanitized).toEqual([{ name: 'search_products', order: 0, input: { query: 'bag' }, result: [{ id: 'p1' }], success: true, durationMs: 42 }]);
  });

  it('marks a call failed and extracts errorMessage when the result has an error field', () => {
    const trace: ToolCallTrace[] = [{ name: 'add_item_to_order', args: { productId: 'p1' }, result: { error: 'not found' }, durationMs: 10 }];

    const sanitized = sanitizeToolTrace(trace);

    expect(sanitized[0].success).toBe(false);
    expect(sanitized[0].errorMessage).toBe('not found');
  });

  it('preserves execution order across multiple calls', () => {
    const trace: ToolCallTrace[] = [
      { name: 'search_products', args: {}, result: [], durationMs: 5 },
      { name: 'get_product_details', args: {}, result: {}, durationMs: 8 },
      { name: 'add_item_to_order', args: {}, result: {}, durationMs: 3 },
    ];

    const sanitized = sanitizeToolTrace(trace);

    expect(sanitized.map((s) => s.order)).toEqual([0, 1, 2]);
    expect(sanitized.map((s) => s.name)).toEqual(['search_products', 'get_product_details', 'add_item_to_order']);
  });

  it('redacts secret-shaped keys at any depth, never persisting them raw', () => {
    const trace: ToolCallTrace[] = [{
      name: 'some_tool',
      args: { apiKey: 'sk-real-secret-value', nested: { access_token: 'super-secret', ok: 'fine' } },
      result: { password: 'hunter2', data: 'ok' },
      durationMs: 1,
    }];

    const sanitized = sanitizeToolTrace(trace);

    const inputStr = JSON.stringify(sanitized[0].input);
    const resultStr = JSON.stringify(sanitized[0].result);
    expect(inputStr).not.toContain('sk-real-secret-value');
    expect(inputStr).not.toContain('super-secret');
    expect(inputStr).toContain('fine');
    expect(resultStr).not.toContain('hunter2');
    expect(resultStr).toContain('ok');
  });

  it('truncates very long string values instead of storing them unbounded', () => {
    const longString = 'x'.repeat(2000);
    const trace: ToolCallTrace[] = [{ name: 'some_tool', args: {}, result: { note: longString }, durationMs: 1 }];

    const sanitized = sanitizeToolTrace(trace);

    const note = (sanitized[0].result as { note: string }).note;
    expect(note.length).toBeLessThan(600);
    expect(note).toContain('truncated');
  });

  it('truncates very large arrays instead of storing them unbounded', () => {
    const bigArray = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const trace: ToolCallTrace[] = [{ name: 'search_products', args: {}, result: bigArray, durationMs: 1 }];

    const sanitized = sanitizeToolTrace(trace);

    const result = sanitized[0].result as unknown[];
    expect(result.length).toBeLessThan(30);
  });

  it('defaults durationMs to null when not provided (older/hand-built trace entries)', () => {
    const trace = [{ name: 'search_products', args: {}, result: {} }] as ToolCallTrace[];

    const sanitized = sanitizeToolTrace(trace);

    expect(sanitized[0].durationMs).toBeNull();
  });

  it('handles a realistic multi-tool turn (delivery, payment, catalogue, a tool error) without leaking anything sensitive', () => {
    const trace: ToolCallTrace[] = [
      {
        name: 'arrange_delivery',
        args: { recipientName: 'Dora Acheampong', phone: '0542415463', address: 'Kwabenya Abuom Junction', method: 'Yango' },
        result: { taskId: 'task-abc123', status: 'OPEN' },
        durationMs: 45,
      },
      {
        name: 'submit_order_for_payment',
        args: {},
        result: { orderId: 'order-1', paymentLink: 'https://checkout.paystack.com/abc123xyz', reference: 'VRZ-C-ABC123' },
        durationMs: 320,
      },
      {
        name: 'search_products',
        args: { query: 'paper bag' },
        result: [
          { id: 'p1', name: 'Size 1 Brown Paper Bag', priceMajorUnits: 5.5, currency: 'GHS', inStock: true },
          { id: 'p2', name: 'Size 2 Brown Paper Bag', priceMajorUnits: 6.5, currency: 'GHS', inStock: true },
        ],
        durationMs: 60,
      },
      {
        name: 'get_order_status',
        args: { orderId: 'order-1' },
        result: { error: 'Something went wrong on our end -- try again in a moment.' },
        durationMs: 15,
      },
    ];

    const sanitized = sanitizeToolTrace(trace);

    expect(sanitized).toHaveLength(4);
    expect(sanitized.map((s) => s.name)).toEqual(['arrange_delivery', 'submit_order_for_payment', 'search_products', 'get_order_status']);
    expect(sanitized.map((s) => s.success)).toEqual([true, true, true, false]);
    expect(sanitized[3].errorMessage).toBe('Something went wrong on our end -- try again in a moment.');
    // Ordinary business data (customer name/phone/address, order references, payment
    // links, product info) is expected to appear -- it's not a secret, it's the point
    // of the trace. Confirms the sanitizer isn't over-redacting real business data.
    const asString = JSON.stringify(sanitized);
    expect(asString).toContain('Dora Acheampong');
    expect(asString).toContain('Kwabenya Abuom Junction');
    expect(asString).toContain('checkout.paystack.com/abc123xyz');
    expect(asString).toContain('Brown Paper Bag');
  });

  it('redacts secret-shaped fields even when buried inside otherwise-realistic business data', () => {
    const trace: ToolCallTrace[] = [{
      name: 'weird_hypothetical_tool',
      args: { config: { paystackSecretKey: 'sk_live_should_never_appear', webhookAuthorization: 'Bearer abc.def.ghi' } },
      result: { ok: true, internal: { dbPassword: 'should-be-redacted', normalField: 'this is fine' } },
      durationMs: 5,
    }];

    const sanitized = sanitizeToolTrace(trace);
    const asString = JSON.stringify(sanitized);

    expect(asString).not.toContain('sk_live_should_never_appear');
    expect(asString).not.toContain('Bearer abc.def.ghi');
    expect(asString).not.toContain('should-be-redacted');
    expect(asString).toContain('this is fine');
  });

  it('never throws -- returns an empty array rather than crashing the turn it describes', () => {
    // A circular reference would blow the stack in a naive JSON.stringify-based
    // approach; this sanitizer recurses structurally with a depth cap instead, but
    // the try/catch is still a deliberate last-resort guarantee.
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const trace = [{ name: 'weird_tool', args: {}, result: circular, durationMs: 1 }] as ToolCallTrace[];

    expect(() => sanitizeToolTrace(trace)).not.toThrow();
  });
});
