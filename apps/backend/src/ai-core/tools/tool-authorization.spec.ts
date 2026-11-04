import { ToolRegistryService } from './tool-registry.service';
import { ToolCallingService } from './tool-calling.service';
import { ToolExecutionContext } from './tool-registry.types';
import { AiProviderError } from '../providers/ai-provider.interface';

/**
 * Per-tool authorisation review, executed against the REAL tool handlers with recording fakes behind them.
 * The model's arguments are hostile: forged identifiers, wrong types, absurd sizes. What must hold:
 *  - identity (tenant, conversation, contact, phone) comes ONLY from the trusted context, never from arguments;
 *  - a handler never forwards a non-string where an id is expected (an object would become a database filter);
 *  - numbers and text are bounded before they reach a service;
 *  - a context whose ids do not belong together never reaches a handler.
 */
type Call = { svc: string; method: string; args: unknown[] };
const CTX: ToolExecutionContext = { tenantId: 'T-REAL', conversationId: 'C-REAL', contactId: 'K-REAL', customerPhone: '+233200000000' };
const EVIL = 'EVIL-OTHER-TENANT';

function build(opts: { conversationOk?: boolean } = {}) {
  const calls: Call[] = [];
  const recorder = (svc: string, impl: Record<string, (...a: unknown[]) => unknown> = {}) => new Proxy({}, {
    get: (_t, method: string) => (...args: unknown[]) => {
      calls.push({ svc, method, args });
      if (impl[method]) return impl[method]!(...args);
      return Promise.resolve(null);
    },
  });
  const product = { id: 'P1', name: 'Bag', description: 'd', priceMajorUnits: 10, currency: 'GHS', stockQuantity: 5, variants: null, imageUrl: 'https://img/p.png' };
  const products = recorder('products', { findAll: async () => [product], findOne: async () => product });
  const draft = { id: 'O1', items: [], totalMajorUnits: 0, currency: 'GHS', contactId: CTX.contactId, status: 'DRAFT' };
  const orders = recorder('orders', {
    findActiveDraftForConversation: async () => draft, findMostRecentForConversation: async () => draft, findOwnedByContact: async () => null,
    addItem: async () => ({ ...draft, items: [] }), createDraft: async () => draft, submitForPayment: async () => ({ ...draft, status: 'AWAITING_PAYMENT' }),
  });
  const tasks = recorder('tasks', { create: async () => ({ id: 'TK1', status: 'OPEN', assignedTeamId: null }) });
  const state = recorder('state', { mergeState: async () => undefined });
  const prisma = {
    conversation: { count: async (a: unknown) => { calls.push({ svc: 'prisma.conversation', method: 'count', args: [a] }); return opts.conversationOk === false ? 0 : 1; } },
    tenantSettings: { findUnique: async (a: unknown) => { calls.push({ svc: 'prisma.tenantSettings', method: 'findUnique', args: [a] }); return { deliveryEnabled: true, deliveryInfo: 'x' }; } },
  };
  const registry = new ToolRegistryService(products as never, orders as never, tasks as never, state as never, prisma as never);
  registry.onModuleInit();
  return { registry, calls, nonVerify: () => calls.filter((c) => c.svc !== 'prisma.conversation') };
}

const deepContains = (v: unknown, needle: string): boolean => JSON.stringify(v)?.includes(needle) ?? false;
const ALL_TOOLS = ['search_products', 'get_product_details', 'add_item_to_order', 'get_current_order', 'submit_order_for_payment', 'get_order_status', 'create_internal_task',
  'send_product_image', 'remember_conversation_facts', 'set_pending_action', 'clear_pending_action', 'check_delivery_info', 'arrange_delivery'];

describe('tool registry: every tool is registered and reviewed', () => {
  it('has exactly the tools this review covers (a new tool must be added to this file)', () => {
    const { registry } = build();
    expect(registry.getDefs(ALL_TOOLS).map((d) => d.name).sort()).toEqual([...ALL_TOOLS].sort());
  });
});

describe('identity comes only from the trusted context', () => {
  const hostile = {
    tenantId: EVIL, conversationId: EVIL, contactId: EVIL, customerPhone: EVIL, userId: EVIL, orderId: EVIL, productId: EVIL, phone: EVIL, recipientName: EVIL,
    address: EVIL, department: EVIL, title: EVIL, description: EVIL, quantity: 1, query: EVIL, currentIntent: EVIL, type: EVIL, createdById: EVIL, assignedTeamId: EVIL, dryRun: true, dryRunPayment: true,
  };
  it.each(ALL_TOOLS)('%s never lets a forged identifier reach the data layer as an owner', async (name) => {
    const { registry, nonVerify } = build();
    await registry.execute(name, CTX, hostile);
    const sanctioned = (c: Call) => {
      // The model MAY choose WHICH of this workspace's records to look at (a product id, an order id), but the lookup must still be scoped by the real
      // tenant/contact, which are passed as separate arguments from the context.
      const [first, second] = c.args;
      if (['products', 'orders', 'tasks', 'state'].includes(c.svc)) return first === CTX.tenantId;
      return second !== undefined || c.svc.startsWith('prisma');
    };
    for (const c of nonVerify()) {
      expect(sanctioned(c)).toBe(true);
      // an identity-bearing argument slot must never be the forged value
      if (c.svc === 'tasks') {
        const payload = c.args[1] as Record<string, unknown>;
        for (const k of ['conversationId', 'contactId', 'tenantId', 'createdById', 'assignedTeamId']) {
          if (k in payload) expect(payload[k]).not.toBe(EVIL);
        }
      }
      if (c.svc === 'state') expect(c.args[1]).toBe(CTX.conversationId);      // the conversation is always the context's
      if (c.svc === 'orders' && c.method === 'createDraft') expect(deepContains(c.args, EVIL)).toBe(false);
    }
  });

  it('get_order_status looks up a model-named order only for THIS contact in THIS workspace', async () => {
    const { registry, calls } = build();
    await registry.execute('get_order_status', CTX, { orderId: 'SOMEONE-ELSES-ORDER' });
    const c = calls.find((x) => x.method === 'findOwnedByContact')!;
    expect(c.args).toEqual([CTX.tenantId, CTX.contactId, 'SOMEONE-ELSES-ORDER']);
  });

  it('an order that belongs to another contact is reported as not found', async () => {
    const { registry } = build();
    const r = await registry.execute('get_order_status', CTX, { orderId: 'O-OTHER' });
    expect(r).toEqual({ error: 'Order not found' });
  });
});

describe('arguments are validated before they reach a service', () => {
  const objectIds = [{ startsWith: '' }, { not: 'x' }, ['a'], 42, true, null];
  it.each(['get_product_details', 'send_product_image'])('%s refuses a non-string productId (it would become a database filter)', async (name) => {
    for (const bad of objectIds) {
      const { registry, nonVerify } = build();
      const r = await registry.execute(name, CTX, { productId: bad }) as { error?: string };
      expect(r.error).toBeDefined();
      expect(nonVerify().filter((c) => c.method === 'findOne')).toEqual([]);
    }
  });

  it('add_item_to_order refuses a non-string productId, and a quantity that is fractional, huge, non-finite or not a number', async () => {
    for (const args of [
      { productId: { startsWith: '' }, quantity: 1 }, { productId: 'P1', quantity: 1.5 }, { productId: 'P1', quantity: Infinity }, { productId: 'P1', quantity: '1e9' },
      { productId: 'P1', quantity: 10_001 }, { productId: 'P1', quantity: [3] }, { productId: 'P1', quantity: {} }, { productId: 'P1', quantity: NaN }, { productId: 'P1', quantity: -2 }, { productId: 'P1' },
    ]) {
      const { registry, nonVerify } = build();
      const r = await registry.execute('add_item_to_order', CTX, args) as { error?: string };
      expect(r.error).toBeDefined();
      expect(nonVerify().filter((c) => c.method === 'addItem')).toEqual([]);
    }
    const ok = build();
    await ok.registry.execute('add_item_to_order', CTX, { productId: 'P1', quantity: 3, variantLabel: 'Large' });
    expect(ok.nonVerify().find((c) => c.method === 'addItem')!.args).toEqual([CTX.tenantId, 'O1', { productId: 'P1', quantity: 3, variantLabel: 'Large' }]);
  });

  it('text arguments are bounded and must be strings (tasks, delivery, state)', async () => {
    const big = 'x'.repeat(50_000);
    const t = build();
    await t.registry.execute('create_internal_task', CTX, { department: 'Sales', title: big, description: big, priority: 'urgent' });
    const created = t.nonVerify().find((c) => c.method === 'create')!.args[1] as { title: string; description: string; priority: string };
    expect(created.title.length).toBeLessThanOrEqual(200);
    expect(created.description.length).toBeLessThanOrEqual(4000);
    expect(created.priority).toBe('URGENT');

    for (const bad of [{ department: { a: 1 }, title: 't', description: 'd' }, { department: 'S', title: ['t'], description: 'd' }, { department: 'S', title: 't', description: 5 }]) {
      const b = build();
      expect(await b.registry.execute('create_internal_task', CTX, bad)).toMatchObject({ error: expect.any(String) });
      expect(b.nonVerify().filter((c) => c.method === 'create')).toEqual([]);
    }

    const d = build();
    await d.registry.execute('arrange_delivery', CTX, { recipientName: big, phone: big, address: big, notes: big });
    const task = d.nonVerify().find((c) => c.svc === 'tasks')!.args[1] as { description: string };
    expect(task.description.length).toBeLessThan(1200);
    const dd = build();
    expect(await dd.registry.execute('arrange_delivery', CTX, { recipientName: { x: 1 }, phone: '1', address: 'a' })).toMatchObject({ error: expect.any(String) });
  });

  it('remembered facts are bounded strings only, whatever shape the model sends', async () => {
    const s = build();
    await s.registry.execute('remember_conversation_facts', CTX, {
      currentIntent: 'x'.repeat(5000), lastTopic: { nested: true },
      addKnownFacts: { ok: 'fine', nested: { a: 1 }, num: 5, ['k'.repeat(500)]: 'v', long: 'v'.repeat(5000), ...Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`f${i}`, 'v'])) },
      missingInfo: ['size', { x: 1 }, 'y'.repeat(5000), ...Array.from({ length: 40 }, () => 'more')],
    });
    const patch = s.nonVerify().find((c) => c.method === 'mergeState')!.args[2] as { currentIntent?: string; lastTopic?: unknown; knownFacts?: Record<string, unknown>; missingInfo?: unknown[] };
    expect(patch.currentIntent!.length).toBeLessThanOrEqual(200);
    expect(patch.lastTopic).toBeUndefined();
    expect(Object.values(patch.knownFacts ?? {}).every((v) => typeof v === 'string' && v.length <= 200)).toBe(true);
    expect(Object.keys(patch.knownFacts ?? {}).every((k) => k.length <= 50)).toBe(true);
    expect(Object.keys(patch.knownFacts ?? {}).length).toBeLessThanOrEqual(8);
    expect((patch.missingInfo ?? []).every((m) => typeof m === 'string' && m.length <= 100)).toBe(true);
    expect((patch.missingInfo ?? []).length).toBeLessThanOrEqual(10);

    const p = build();
    await p.registry.execute('set_pending_action', CTX, { type: { a: 1 }, description: 'z'.repeat(5000) });
    const pa = (p.nonVerify().find((c) => c.method === 'mergeState')!.args[2] as { pendingAction: { type: string; description: string } }).pendingAction;
    expect(pa.type).toBe('OTHER');
    expect(pa.description.length).toBeLessThanOrEqual(300);
  });

  it('search_products ignores a non-string query rather than failing open or crashing', async () => {
    const { registry } = build();
    const r = await registry.execute('search_products', CTX, { query: { $ne: '' }, maxPrice: 'cheap', sort: ['price_asc'] });
    expect(Array.isArray(r)).toBe(true);
  });
});

describe('execution-time context verification', () => {
  it('refuses to run any tool when the conversation does not belong to the tenant and contact in the context', async () => {
    for (const name of ALL_TOOLS) {
      const { registry, nonVerify } = build({ conversationOk: false });
      const r = await registry.execute(name, CTX, { productId: 'P1', quantity: 1, query: 'x', department: 'S', title: 't', description: 'd', recipientName: 'n', phone: 'p', address: 'a', type: 'OTHER' });
      expect(r).toEqual({ error: 'This conversation is not available.' });
      expect(nonVerify()).toEqual([]);                                     // no handler, service or data access happened
    }
  });

  it('checks the tenant, conversation AND contact together, on every call', async () => {
    const { registry, calls } = build();
    await registry.execute('get_current_order', CTX, {});
    await registry.execute('get_current_order', CTX, {});
    const checks = calls.filter((c) => c.svc === 'prisma.conversation');
    expect(checks).toHaveLength(2);
    expect(checks[0]!.args[0]).toEqual({ where: { id: CTX.conversationId, tenantId: CTX.tenantId, contactId: CTX.contactId } });
  });

  it('a verification failure (database down) refuses the call instead of running it', async () => {
    const { registry, nonVerify } = build();
    (registry as unknown as { prisma: { conversation: { count: () => Promise<number> } } }).prisma.conversation.count = async () => { throw new Error('db down'); };
    expect(await registry.execute('get_current_order', CTX, {})).toEqual({ error: 'This conversation is not available.' });
    expect(nonVerify()).toEqual([]);
  });

  it('an unknown or prototype-named tool is refused without touching data', async () => {
    const { registry, nonVerify } = build();
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'drop_database', '']) {
      expect(await registry.execute(name, CTX, {})).toEqual({ error: `Unknown tool: ${name}` });
    }
    expect(nonVerify()).toEqual([]);
  });
});

describe('ToolCallingService: offered tools, replays and volume', () => {
  function runWith(toolCallsPerRound: Array<Array<{ name: string; arguments: string }>>, offered: string[]) {
    const executed: string[] = [];
    const registry = {
      getDefs: (names: string[]) => names.map((name) => ({ name, description: '', parameters: {} })),
      execute: jest.fn(async (name: string) => { executed.push(name); return { ok: true, n: executed.length }; }),
      isStateChanging: (name: string) => ['add_item_to_order', 'submit_order_for_payment', 'create_internal_task', 'arrange_delivery', 'send_product_image'].includes(name),
    };
    let round = 0;
    const provider = { key: 'deepseek', complete: jest.fn() };
    const metered = {
      complete: jest.fn(async () => {
        const calls = toolCallsPerRound[round++];
        if (!calls) return { result: { content: 'Done, thanks.', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 }, provider: 'deepseek', model: 'm', latencyMs: 1 } };
        return { result: { content: '', toolCalls: calls.map((c, i) => ({ id: `c${round}-${i}`, ...c })), finishReason: 'tool_calls', usage: { inputTokens: 1, outputTokens: 1 }, provider: 'deepseek', model: 'm', latencyMs: 1 } };
      }),
    };
    const svc = new ToolCallingService({ forModel: () => provider } as never, registry as never, { record: jest.fn().mockResolvedValue({ id: 'e1' }) } as never, metered as never);
    const run = () => svc.complete({ tenantId: 'T', taskType: 'RESPONDER', systemPrompt: 's', historyMessages: [], userMessage: 'hi', toolNames: offered, toolContext: CTX, maxIterations: 4 });
    return { run, executed, registry };
  }

  it('refuses a tool that was not offered this run, including a prototype name', async () => {
    const { run, executed } = runWith([[{ name: 'submit_order_for_payment', arguments: '{}' }, { name: '__proto__', arguments: '{}' }, { name: 'get_current_order', arguments: '{}' }]], ['get_current_order']);
    const r = await run();
    expect(executed).toEqual(['get_current_order']);
    expect(r.toolTrace.map((t) => (t.result as { error?: string }).error ? 'refused' : 'ran')).toEqual(['refused', 'refused', 'ran']);
  });

  it('runs an identical state-changing call once per run (a replayed call returns the earlier result)', async () => {
    const args = '{"productId":"P1","quantity":2}';
    const { run, executed } = runWith([[{ name: 'add_item_to_order', arguments: args }, { name: 'add_item_to_order', arguments: args }], [{ name: 'add_item_to_order', arguments: args }]], ['add_item_to_order']);
    const r = await run();
    expect(executed).toEqual(['add_item_to_order']);
    expect(r.toolTrace).toHaveLength(3);
    expect(r.toolTrace[1]!.result).toEqual(r.toolTrace[0]!.result);
  });

  it('a different state-changing call still runs, and read-only calls are not deduplicated', async () => {
    const { run, executed } = runWith([[
      { name: 'add_item_to_order', arguments: '{"productId":"P1","quantity":1}' }, { name: 'add_item_to_order', arguments: '{"productId":"P2","quantity":1}' },
      { name: 'get_current_order', arguments: '{}' }, { name: 'get_current_order', arguments: '{}' },
    ]], ['add_item_to_order', 'get_current_order']);
    await run();
    expect(executed).toEqual(['add_item_to_order', 'add_item_to_order', 'get_current_order', 'get_current_order']);
  });

  it('caps how many tool calls one model turn and one run may make', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ name: 'get_current_order', arguments: `{"i":${i}}` }));
    const { run, executed } = runWith([many, many, many], ['get_current_order']);
    const r = await run();
    expect(executed.length).toBeLessThanOrEqual(12);
    expect(r.toolTrace.some((t) => (t.result as { error?: string }).error === 'Too many tool calls in this turn.')).toBe(true);
  });

  it('survives a provider failure mid-run without executing further tools', async () => {
    const executed: string[] = [];
    const registry = { getDefs: (n: string[]) => n.map((name) => ({ name, description: '', parameters: {} })), execute: async (n: string) => { executed.push(n); return {}; }, isStateChanging: () => false };
    const metered = { complete: jest.fn().mockRejectedValue(new AiProviderError('network', 'down', true)) };
    const svc = new ToolCallingService({ forModel: () => ({}) } as never, registry as never, { record: jest.fn().mockResolvedValue({ id: 'e' }) } as never, metered as never);
    const r = await svc.complete({ tenantId: 'T', taskType: 'RESPONDER', systemPrompt: 's', historyMessages: [], userMessage: 'hi', toolNames: ['get_current_order'], toolContext: CTX });
    expect(r.failed).toBe(true);
    expect(executed).toEqual([]);
  });
});
