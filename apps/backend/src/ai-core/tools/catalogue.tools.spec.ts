import { buildCatalogueTools, matchesProductQuery, NO_MATCH_MESSAGE } from './catalogue.tools';

const ctx = { tenantId: 't1', conversationId: 'c1', contactId: 'ct1', customerPhone: '+233555000111' };

interface Row { id: string; name: string; description: string | null; priceMajorUnits: number; currency: string; stockQuantity: number | null; imageUrl: string | null; variants: unknown }

const catalogue: Row[] = [
  { id: 'p1', name: 'Blue Denim Jacket', description: 'Classic fit', priceMajorUnits: 120, currency: 'GHS', stockQuantity: 5, imageUrl: null, variants: null },
  { id: 'p2', name: 'Red Sneakers', description: null, priceMajorUnits: 80, currency: 'GHS', stockQuantity: 0, imageUrl: 'x', variants: null },
  { id: 'p3', name: 'Canvas Tote Bag', description: 'Roomy bag for the market', priceMajorUnits: 45, currency: 'GHS', stockQuantity: null, imageUrl: null, variants: [{ name: 'Large', priceDeltaMajorUnits: 10, stockQuantity: 0 }, { name: 'Small', stockQuantity: 3 }, { nope: true }, 'junk'] },
];

function search(rows: Row[]) {
  const products = { findAll: jest.fn().mockResolvedValue(rows), findOne: jest.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tool = buildCatalogueTools(products as any).find((t) => t.def.name === 'search_products');
  if (!tool) throw new Error('search_products not registered');
  return { run: (args: Record<string, unknown>) => tool.execute(ctx, args), products };
}

describe('search_products', () => {
  it('reads only the signed-in tenant\'s active products', async () => {
    const { run, products } = search(catalogue);
    await run({ query: 'jacket' });
    expect(products.findAll).toHaveBeenCalledWith('t1', true);
  });

  it('returns the matching product with its real price and stock for a valid name', async () => {
    const { run } = search(catalogue);
    expect(await run({ query: 'Blue Denim Jacket' })).toEqual([
      { id: 'p1', name: 'Blue Denim Jacket', description: 'Classic fit', priceMajorUnits: 120, currency: 'GHS', inStock: true, variants: null, hasImage: false },
    ]);
  });

  it('finds a valid product when the words come in a different order or only some are given', async () => {
    const { run } = search(catalogue);
    expect(await run({ query: 'denim jacket blue' })).toHaveLength(1);
    expect(await run({ query: 'denim' })).toHaveLength(1);
  });

  it('answers a nonexistent product with an explicit not-found result and no products', async () => {
    const { run } = search(catalogue);
    const result = await run({ query: 'Titanium Deluxe Widget Pro' });
    expect(result).toEqual({ found: false, products: [], message: NO_MATCH_MESSAGE });
    expect(NO_MATCH_MESSAGE).toMatch(/ask them to clarify/);
    expect(NO_MATCH_MESSAGE).toMatch(/do not offer a different product as if it were the one they asked for/);
    // Not shaped like a tool failure, which the trace treats as an error.
    expect(result).not.toHaveProperty('error');
  });

  it('does not return a similar product when only some of the words match', async () => {
    const { run } = search(catalogue);
    expect(await run({ query: 'Blue Denim Jacket Pro' })).toMatchObject({ found: false, products: [] });
    expect(await run({ query: 'Red Denim Jacket' })).toMatchObject({ found: false, products: [] });
  });

  it('answers an empty catalogue with the same not-found result', async () => {
    const { run } = search([]);
    expect(await run({ query: 'jacket' })).toMatchObject({ found: false, products: [] });
  });

  it('lists the catalogue when no query is given, and an empty catalogue is simply an empty list', async () => {
    expect(await search(catalogue).run({})).toHaveLength(3);
    expect(await search([]).run({})).toEqual([]);
  });

  it('reports stock from the catalogue: zero is out of stock', async () => {
    const result = (await search(catalogue).run({ query: 'sneakers' })) as Array<{ inStock: boolean }>;
    expect(result[0].inStock).toBe(false);
  });
});

describe('search_products for selling', () => {
  const names = (r: unknown) => (r as Array<{ name: string }>).map((p) => p.name);

  it('applies a budget: only products at or under maxPrice', async () => {
    expect(names(await search(catalogue).run({ maxPrice: 100 }))).toEqual(['Red Sneakers', 'Canvas Tote Bag']);
  });

  it('applies a minimum price', async () => {
    expect(names(await search(catalogue).run({ minPrice: 100 }))).toEqual(['Blue Denim Jacket']);
  });

  it('sorts cheapest first and most expensive first, from the real prices', async () => {
    expect(names(await search(catalogue).run({ sort: 'price_asc' }))).toEqual(['Canvas Tote Bag', 'Red Sneakers', 'Blue Denim Jacket']);
    expect(names(await search(catalogue).run({ sort: 'price_desc' }))).toEqual(['Blue Denim Jacket', 'Red Sneakers', 'Canvas Tote Bag']);
  });

  it('says not found when the budget excludes everything, rather than returning nothing', async () => {
    expect(await search(catalogue).run({ maxPrice: 10 })).toMatchObject({ found: false, products: [] });
  });

  it('ignores a non-numeric budget instead of filtering on garbage', async () => {
    expect(await search(catalogue).run({ maxPrice: 'cheap', minPrice: Number.NaN })).toHaveLength(3);
  });

  it('gives the model the description and the variants, with stock only as in stock or not', async () => {
    const [tote] = (await search(catalogue).run({ query: 'tote' })) as Array<Record<string, unknown>>;
    expect(tote['description']).toBe('Roomy bag for the market');
    expect(tote['variants']).toEqual([
      { name: 'Large', priceDeltaMajorUnits: 10, inStock: false },
      { name: 'Small', priceDeltaMajorUnits: 0, inStock: true },
    ]);
    expect(tote['inStock']).toBe(true);
    expect(JSON.stringify(tote)).not.toMatch(/stockQuantity/);
  });

  it('shortens a very long description', async () => {
    const long = { ...catalogue[0], description: `Soft cotton. ${'x'.repeat(1000)}` };
    const [p] = (await search([long]).run({})) as Array<{ description: string }>;
    expect(p.description.length).toBeLessThanOrEqual(240);
    expect(p.description.endsWith('…')).toBe(true);
  });
});

describe('matchesProductQuery', () => {
  const p = { name: 'Blue Denim Jacket', description: 'Classic fit' };
  it.each([['jacket', true], ['classic', true], ['JACKET BLUE', true], ['jacket pro', false], ['', false], ['   ', false]])('%j -> %s', (q, expected) => {
    expect(matchesProductQuery(p, q.toLowerCase().trim())).toBe(expected);
  });
});
