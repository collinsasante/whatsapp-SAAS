import { ProductsService } from '../../commerce/products/products.service';
import { ToolDefinition, ToolExecutionContext } from './tool-registry.types';

/** Migrated verbatim from CommerceAiService.executeTool's search_products/get_product_details
 * cases -- same ProductsService calls, same result shape, same behavior. Only the calling
 * convention changed (registry dispatch instead of a switch statement). */
export function buildCatalogueTools(products: ProductsService): ToolDefinition[] {
  return [
    {
      def: {
        name: 'search_products',
        description: 'Search the catalogue for products matching a query. Call this whenever the customer asks about a product, price, or availability.',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Search term, e.g. product name or category. Omit to list everything.' } },
        },
      },
      execute: async (ctx: ToolExecutionContext, args) => {
        const query = (args['query'] as string | undefined)?.toLowerCase().trim();
        const all = await products.findAll(ctx.tenantId, true);
        const filtered = query
          ? all.filter((p) => p.name.toLowerCase().includes(query) || p.description?.toLowerCase().includes(query))
          : all;
        return filtered.slice(0, 15).map((p) => ({ id: p.id, name: p.name, priceMajorUnits: p.priceMajorUnits, currency: p.currency, inStock: p.stockQuantity === null || p.stockQuantity > 0, hasImage: !!p.imageUrl }));
      },
    },
    {
      def: {
        name: 'get_product_details',
        description: 'Get full details (price, stock, variants) for one specific product by its ID.',
        parameters: {
          type: 'object',
          properties: { productId: { type: 'string' } },
          required: ['productId'],
        },
      },
      execute: async (ctx: ToolExecutionContext, args) => {
        const productId = args['productId'] as string;
        if (!productId) return { error: 'productId is required' };
        const product = await products.findOne(ctx.tenantId, productId).catch(() => null);
        if (!product) return { error: 'Product not found' };
        return { id: product.id, name: product.name, description: product.description, priceMajorUnits: product.priceMajorUnits, currency: product.currency, stockQuantity: product.stockQuantity, variants: product.variants, hasImage: !!product.imageUrl };
      },
    },
  ];
}
