import { NotFoundException } from '@nestjs/common';
import { ToolRegistryService } from './tool-registry.service';

function buildDeps() {
  return {
    products: { findAll: jest.fn().mockResolvedValue([]), findOne: jest.fn() },
    orders: { findMostRecentForConversation: jest.fn().mockResolvedValue(null) },
    internalTasks: { create: jest.fn() },
    conversationState: { getState: jest.fn(), mergeState: jest.fn().mockResolvedValue(undefined) },
  };
}

function buildService(deps: ReturnType<typeof buildDeps>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new ToolRegistryService(deps.products as any, deps.orders as any, deps.internalTasks as any, deps.conversationState as any);
  service.onModuleInit();
  return service;
}

describe('ToolRegistryService', () => {
  it('registers all commerce/catalogue/task/media/state tools on init', () => {
    const service = buildService(buildDeps());

    const defs = service.getDefs([
      'search_products', 'get_product_details', 'add_item_to_order',
      'get_current_order', 'submit_order_for_payment', 'get_order_status', 'create_internal_task',
      'send_product_image', 'remember_conversation_facts',
    ]);

    expect(defs.map((d) => d.name).sort()).toEqual([
      'add_item_to_order', 'create_internal_task', 'get_current_order', 'get_order_status',
      'get_product_details', 'remember_conversation_facts', 'search_products', 'send_product_image', 'submit_order_for_payment',
    ]);
  });

  it('getDefs silently drops unknown tool names rather than throwing', () => {
    const service = buildService(buildDeps());

    const defs = service.getDefs(['search_products', 'not_a_real_tool']);

    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('search_products');
  });

  it('getDefs returns an empty array for an empty request', () => {
    const service = buildService(buildDeps());

    expect(service.getDefs([])).toEqual([]);
  });

  describe('execute', () => {
    it('dispatches to the matching tool and returns its result', async () => {
      const deps = buildDeps();
      deps.products.findAll.mockResolvedValue([{ id: 'p1', name: 'Wallet', description: null, priceMajorUnits: 90, currency: 'GHS', stockQuantity: 5 }]);
      const service = buildService(deps);

      const result = await service.execute('search_products', { tenantId: 't1', conversationId: 'c1', contactId: 'ct1', customerPhone: '+233' }, {});

      expect(result).toEqual([{ id: 'p1', name: 'Wallet', priceMajorUnits: 90, currency: 'GHS', inStock: true, hasImage: false }]);
    });

    it('returns an error object for an unknown tool name instead of throwing', async () => {
      const service = buildService(buildDeps());

      const result = await service.execute('not_a_real_tool', { tenantId: 't1', conversationId: 'c1', contactId: 'ct1', customerPhone: '+233' }, {});

      expect(result).toEqual({ error: 'Unknown tool: not_a_real_tool' });
    });

    it('sanitizes a raw error into a generic message instead of leaking it into the model context', async () => {
      const deps = buildDeps();
      deps.products.findAll.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:5432 -- connection refused by postgres'));
      const service = buildService(deps);

      const result = await service.execute('search_products', { tenantId: 't1', conversationId: 'c1', contactId: 'ct1', customerPhone: '+233' }, {});

      expect(result).toEqual({ error: 'Something went wrong on our end -- try again in a moment.' });
    });

    it('passes through a deliberately-worded HttpException message unchanged -- already customer-safe', async () => {
      const deps = buildDeps();
      deps.products.findAll.mockRejectedValue(new NotFoundException('No order has been started yet'));
      const service = buildService(deps);

      const result = await service.execute('search_products', { tenantId: 't1', conversationId: 'c1', contactId: 'ct1', customerPhone: '+233' }, {});

      expect(result).toEqual({ error: 'No order has been started yet' });
    });
  });
});
