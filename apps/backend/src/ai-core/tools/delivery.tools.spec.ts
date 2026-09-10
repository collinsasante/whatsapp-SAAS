import { buildDeliveryTools } from './delivery.tools';
import { ToolExecutionContext } from './tool-registry.types';

function buildCtx(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return { tenantId: 't1', conversationId: 'conv1', contactId: 'contact1', customerPhone: '+233555000111', ...overrides };
}

function getTool(name: string, prisma: unknown, internalTasks: unknown, orders: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools = buildDeliveryTools(prisma as any, internalTasks as any, orders as any);
  const tool = tools.find((t) => t.def.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  return tool;
}

describe('check_delivery_info -- Verz-AI unification, Phase Q', () => {
  it('returns deliveryAvailable: false when the tenant has not enabled delivery', async () => {
    const prisma = { tenantSettings: { findUnique: jest.fn().mockResolvedValue({ deliveryEnabled: false, deliveryInfo: null }) } };
    const tool = getTool('check_delivery_info', prisma, {}, {});

    const result = await tool.execute(buildCtx(), {});

    expect(result).toEqual({ deliveryAvailable: false });
  });

  it('returns deliveryAvailable: false when the tenant has no settings row at all', async () => {
    const prisma = { tenantSettings: { findUnique: jest.fn().mockResolvedValue(null) } };
    const tool = getTool('check_delivery_info', prisma, {}, {});

    const result = await tool.execute(buildCtx(), {});

    expect(result).toEqual({ deliveryAvailable: false });
  });

  it('returns the tenant-configured info when delivery is enabled', async () => {
    const prisma = { tenantSettings: { findUnique: jest.fn().mockResolvedValue({ deliveryEnabled: true, deliveryInfo: 'Yango within Accra, GHS 20-40 depending on area.' }) } };
    const tool = getTool('check_delivery_info', prisma, {}, {});

    const result = await tool.execute(buildCtx(), {});

    expect(result).toEqual({ deliveryAvailable: true, info: 'Yango within Accra, GHS 20-40 depending on area.' });
  });

  it('scopes the lookup to the calling tenant', async () => {
    const prisma = { tenantSettings: { findUnique: jest.fn().mockResolvedValue({ deliveryEnabled: true, deliveryInfo: 'x' }) } };
    const tool = getTool('check_delivery_info', prisma, {}, {});

    await tool.execute(buildCtx({ tenantId: 't-specific' }), {});

    expect(prisma.tenantSettings.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 't-specific' } }));
  });
});

describe('arrange_delivery -- Verz-AI unification, Phase Q', () => {
  it('rejects when required fields are missing', async () => {
    const internalTasks = { create: jest.fn() };
    const tool = getTool('arrange_delivery', {}, internalTasks, { findMostRecentForConversation: jest.fn() });

    const result = await tool.execute(buildCtx(), { recipientName: 'Dora' });

    expect(result).toHaveProperty('error');
    expect(internalTasks.create).not.toHaveBeenCalled();
  });

  it('creates a real InternalTask in the Delivery department with the collected details', async () => {
    const internalTasks = { create: jest.fn().mockResolvedValue({ id: 'task-1', status: 'OPEN' }) };
    const orders = { findMostRecentForConversation: jest.fn().mockResolvedValue({ id: 'order-1' }) };
    const tool = getTool('arrange_delivery', {}, internalTasks, orders);

    const result = await tool.execute(buildCtx(), {
      recipientName: 'Dora Acheampong',
      phone: '0542415463',
      address: 'Kwabenya Abuom Junction',
      method: 'Yango',
    });

    expect(internalTasks.create).toHaveBeenCalledWith('t1', expect.objectContaining({
      department: 'Delivery',
      conversationId: 'conv1',
      contactId: 'contact1',
      orderId: 'order-1',
      description: expect.stringContaining('Dora Acheampong'),
    }));
    expect(result).toEqual({ taskId: 'task-1', status: 'OPEN' });
  });

  it('still creates the task when there is no order for this conversation (delivery is not always tied to a commerce order)', async () => {
    const internalTasks = { create: jest.fn().mockResolvedValue({ id: 'task-1', status: 'OPEN' }) };
    const orders = { findMostRecentForConversation: jest.fn().mockResolvedValue(null) };
    const tool = getTool('arrange_delivery', {}, internalTasks, orders);

    await tool.execute(buildCtx(), { recipientName: 'Dora', phone: '054', address: 'Kasoa' });

    expect(internalTasks.create).toHaveBeenCalledWith('t1', expect.objectContaining({ orderId: undefined }));
  });
});
