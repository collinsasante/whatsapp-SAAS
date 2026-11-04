import { INestApplication } from '@nestjs/common';
import { createTestingApp } from './utils/test-app';
import { ToolRegistryService } from '../src/ai-core/tools/tool-registry.service';
import { ToolExecutionContext } from '../src/ai-core/tools/tool-registry.types';
import { testPrisma, resetTestDatabase, createTenantWithUser, disconnectTestDatabase } from './utils/test-db';

/**
 * The AI tools against the REAL services and a real database, with two workspaces. Everything the model controls (ids, quantities, text) is hostile;
 * what the server controls (the context) is also tampered with, to prove the data layer, not just the tool list, holds the boundary.
 */
describe('AI tool authorisation (e2e, real database)', () => {
  let app: INestApplication;
  let registry: ToolRegistryService;
  beforeAll(async () => { app = await createTestingApp(); registry = app.get(ToolRegistryService); });
  afterAll(async () => { await app.close(); await disconnectTestDatabase(); });
  beforeEach(resetTestDatabase);

  async function workspace(label: string) {
    const { tenant } = await createTenantWithUser({ tenantName: label });
    await testPrisma.tenantSettings.create({ data: { tenantId: tenant.id, commerceEnabled: true, deliveryEnabled: true, deliveryInfo: `${label} delivers` } });
    const contact = await testPrisma.contact.create({ data: { tenantId: tenant.id, phone: `+2335${label.length}000000`, name: `${label} customer` } });
    const conversation = await testPrisma.conversation.create({ data: { tenantId: tenant.id, contactId: contact.id, status: 'OPEN' } });
    const product = await testPrisma.product.create({ data: { tenantId: tenant.id, name: `${label} secret product`, priceMajorUnits: 10, imageUrl: `https://img/${label}.png` } });
    const order = await testPrisma.order.create({ data: { tenantId: tenant.id, contactId: contact.id, conversationId: conversation.id, subtotalMajorUnits: 10, totalMajorUnits: 10, customerPhone: contact.phone ?? 'x', status: 'PENDING_PAYMENT' } });
    const ctx: ToolExecutionContext = { tenantId: tenant.id, conversationId: conversation.id, contactId: contact.id, customerPhone: contact.phone ?? 'x' };
    return { tenant, contact, conversation, product, order, ctx };
  }

  it('reads and writes only the context\'s own workspace, whatever ids the model names', async () => {
    const a = await workspace('Alpha'); const b = await workspace('Bravo');
    // product of the other workspace
    expect(await registry.execute('get_product_details', a.ctx, { productId: b.product.id })).toEqual({ error: 'Product not found' });
    expect(await registry.execute('send_product_image', a.ctx, { productId: b.product.id })).toEqual({ error: 'Product not found' });
    expect(await registry.execute('add_item_to_order', a.ctx, { productId: b.product.id, quantity: 1 })).toMatchObject({ error: expect.any(String) });
    expect(await testPrisma.orderItem.count({ where: { productId: b.product.id } })).toBe(0);
    // order of the other workspace/contact, and of another contact in the same workspace
    expect(await registry.execute('get_order_status', a.ctx, { orderId: b.order.id })).toEqual({ error: 'Order not found' });
    const sameTenantOther = await testPrisma.contact.create({ data: { tenantId: a.tenant.id, phone: '+233599999999', name: 'Other customer' } });
    const otherOrder = await testPrisma.order.create({ data: { tenantId: a.tenant.id, contactId: sameTenantOther.id, subtotalMajorUnits: 5, totalMajorUnits: 5, customerPhone: '+233599999999', status: 'PAID' } });
    expect(await registry.execute('get_order_status', a.ctx, { orderId: otherOrder.id })).toEqual({ error: 'Order not found' });
    // catalogue search never returns the other workspace's products
    const found = await registry.execute('search_products', a.ctx, {}) as Array<{ name: string }>;
    expect(found.map((p) => p.name)).toEqual(['Alpha secret product']);
    // delivery info is the context's workspace's
    expect(await registry.execute('check_delivery_info', a.ctx, {})).toEqual({ deliveryAvailable: true, info: 'Alpha delivers' });
  });

  it('a forged conversation, contact or tenant in the context never reaches a handler', async () => {
    const a = await workspace('Alpha'); const b = await workspace('Bravo');
    const forged: ToolExecutionContext[] = [
      { ...a.ctx, conversationId: b.conversation.id },                       // tenant A acting on B's conversation
      { ...a.ctx, tenantId: b.tenant.id },                                    // B's tenant with A's conversation
      { ...a.ctx, contactId: b.contact.id },                                  // A's conversation with B's contact
      { ...a.ctx, conversationId: '00000000-0000-4000-8000-0000000000ff' },   // nonexistent
    ];
    for (const ctx of forged) {
      for (const [name, args] of [['get_current_order', {}], ['get_order_status', {}], ['search_products', {}], ['remember_conversation_facts', { currentIntent: 'x' }], ['create_internal_task', { department: 'S', title: 't', description: 'd' }], ['add_item_to_order', { productId: a.product.id, quantity: 1 }]] as const) {
        expect(await registry.execute(name, ctx, args)).toEqual({ error: 'This conversation is not available.' });
      }
    }
    expect(await testPrisma.internalTask.count()).toBe(0);
    expect(await testPrisma.order.count({ where: { status: 'DRAFT' } })).toBe(0);
    expect((await testPrisma.conversation.findUniqueOrThrow({ where: { id: b.conversation.id } })).aiState).toBeNull();
  });

  it('an object smuggled in as an id is not turned into a filter that "finds" a record', async () => {
    const a = await workspace('Alpha');
    for (const bad of [{ startsWith: '' }, { not: 'x' }, { contains: 'Alpha' }, [a.product.id]]) {
      expect(await registry.execute('get_product_details', a.ctx, { productId: bad })).toEqual({ error: 'productId is required' });
      expect(await registry.execute('add_item_to_order', a.ctx, { productId: bad, quantity: 1 })).toMatchObject({ error: expect.any(String) });
    }
    expect(await testPrisma.orderItem.count()).toBe(0);
  });

  it('tasks and delivery requests are created in the context\'s workspace and conversation, ignoring ids the model supplies', async () => {
    const a = await workspace('Alpha'); const b = await workspace('Bravo');
    await registry.execute('create_internal_task', a.ctx, { department: 'Sales', title: 'Call back', description: 'd', tenantId: b.tenant.id, conversationId: b.conversation.id, contactId: b.contact.id, orderId: b.order.id });
    await registry.execute('arrange_delivery', a.ctx, { recipientName: 'Ama', phone: '+233244000000', address: 'East Legon', conversationId: b.conversation.id });
    const tasks = await testPrisma.internalTask.findMany();
    expect(tasks).toHaveLength(2);
    for (const t of tasks) expect(t).toMatchObject({ tenantId: a.tenant.id, conversationId: a.conversation.id, contactId: a.contact.id });
    expect(tasks.every((t) => t.orderId !== b.order.id)).toBe(true);
  });

  it('quantities that would corrupt an order are refused; a valid one is stored exactly', async () => {
    const a = await workspace('Alpha');
    for (const quantity of [1.5, 0, -1, 10_001, Number.MAX_SAFE_INTEGER, '3', Infinity]) {
      expect(await registry.execute('add_item_to_order', a.ctx, { productId: a.product.id, quantity })).toMatchObject({ error: expect.any(String) });
    }
    expect(await testPrisma.orderItem.count()).toBe(0);
    const ok = await registry.execute('add_item_to_order', a.ctx, { productId: a.product.id, quantity: 3 }) as { totalMajorUnits: number };
    expect(ok.totalMajorUnits).toBe(30);
    expect((await testPrisma.orderItem.findFirstOrThrow()).quantity).toBe(3);
  });

  it('remembered facts are stored bounded, under the context\'s own conversation only', async () => {
    const a = await workspace('Alpha'); const b = await workspace('Bravo');
    await registry.execute('remember_conversation_facts', a.ctx, { currentIntent: 'x'.repeat(5000), addKnownFacts: { size: 'M', evil: { a: 1 } } });
    const stored = (await testPrisma.conversation.findUniqueOrThrow({ where: { id: a.conversation.id } })).aiState as { currentIntent: string; knownFacts: Record<string, string> };
    expect(stored.currentIntent).toHaveLength(200);
    expect(stored.knownFacts).toEqual({ size: 'M' });
    expect((await testPrisma.conversation.findUniqueOrThrow({ where: { id: b.conversation.id } })).aiState).toBeNull();
  });
});
