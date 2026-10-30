import { ProductsService } from '../../commerce/products/products.service';
import { ToolDefinition, ToolExecutionContext } from './tool-registry.types';

/** Migrated verbatim from CommerceAiService.executeTool's search_products/get_product_details
 * cases -- same ProductsService calls, same result shape, same behavior. Only the calling
 * convention changed (registry dispatch instead of a switch statement). */
export const NO_MATCH_MESSAGE =
  'No active product in the catalogue matches this search. Tell the customer you could not find it and ask them to clarify (the exact name, or what they are looking for). ' +
  'Do not state a price or stock level for it, do not say you have it, and do not offer a different product as if it were the one they asked for.';

/** Every word of the query must appear in the name or description, in any order, so "denim jacket blue" finds "Blue Denim Jacket". A
 * query is never loosened to a partial match: a product that only shares some of the words is a different product. */
export function matchesProductQuery(product: { name: string; description?: string | null }, query: string): boolean {
  const haystack = `${product.name} ${product.description ?? ''}`.toLowerCase();
  const words = query.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => haystack.includes(w));
}

const MAX_DESCRIPTION_CHARS = 240;

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function shortDescription(description: string | null | undefined): string | null {
  const text = description?.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > MAX_DESCRIPTION_CHARS ? `${text.slice(0, MAX_DESCRIPTION_CHARS - 1)}…` : text;
}

/** Variants are free-form JSON entered by the merchant: keep only the fields a customer can be told, and drop anything malformed. */
function summariseVariants(variants: unknown): Array<{ name: string; priceDeltaMajorUnits: number; inStock: boolean }> | null {
  if (!Array.isArray(variants)) return null;
  const out = variants.flatMap((v) => {
    if (!v || typeof v !== 'object') return [];
    const { name, priceDeltaMajorUnits, stockQuantity } = v as Record<string, unknown>;
    if (typeof name !== 'string' || !name.trim()) return [];
    return [{
      name: name.trim(),
      priceDeltaMajorUnits: typeof priceDeltaMajorUnits === 'number' && Number.isFinite(priceDeltaMajorUnits) ? priceDeltaMajorUnits : 0,
      inStock: typeof stockQuantity === 'number' ? stockQuantity > 0 : true,
    }];
  });
  return out.length > 0 ? out : null;
}

export function buildCatalogueTools(products: ProductsService): ToolDefinition[] {
  return [
    {
      def: {
        name: 'search_products',
        description: 'Search the catalogue for products matching a query. Call this whenever the customer asks about a product, price, or availability, or describes something they need. Each result carries its real price, a short description, its variants and whether it is in stock.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Words that must all appear in the product name or description, e.g. a product name or category. Omit to list everything, which is the way to browse when the customer describes a need rather than a product.' },
            maxPrice: { type: 'number', description: 'Only products priced at or below this amount (major units, e.g. 100 for GH₵100). Use for "under 100" or a stated budget.' },
            minPrice: { type: 'number', description: 'Only products priced at or above this amount.' },
            sort: { type: 'string', enum: ['price_asc', 'price_desc'], description: 'price_asc for cheapest first, price_desc for most expensive first.' },
          },
        },
      },
      execute: async (ctx: ToolExecutionContext, args) => {
        const query = (args['query'] as string | undefined)?.toLowerCase().trim();
        const maxPrice = finiteNumber(args['maxPrice']);
        const minPrice = finiteNumber(args['minPrice']);
        const sort = args['sort'];
        const all = await products.findAll(ctx.tenantId, true);
        let filtered = query ? all.filter((p) => matchesProductQuery(p, query)) : all;
        if (maxPrice !== undefined) filtered = filtered.filter((p) => p.priceMajorUnits <= maxPrice);
        if (minPrice !== undefined) filtered = filtered.filter((p) => p.priceMajorUnits >= minPrice);
        if (sort === 'price_asc') filtered = [...filtered].sort((a, b) => a.priceMajorUnits - b.priceMajorUnits);
        if (sort === 'price_desc') filtered = [...filtered].sort((a, b) => b.priceMajorUnits - a.priceMajorUnits);
        if (filtered.length === 0 && (query || maxPrice !== undefined || minPrice !== undefined)) {
          // An empty array gives the model nothing to say, and it has filled that gap with an invented or substituted product.
          // The answer to "no match" is explicit, so the reply can only be "not found, please clarify".
          return { found: false, products: [], message: NO_MATCH_MESSAGE };
        }
        return filtered.slice(0, 15).map((p) => ({
          id: p.id,
          name: p.name,
          description: shortDescription(p.description),
          priceMajorUnits: p.priceMajorUnits,
          currency: p.currency,
          inStock: p.stockQuantity === null || p.stockQuantity > 0,
          variants: summariseVariants(p.variants),
          hasImage: !!p.imageUrl,
        }));
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
