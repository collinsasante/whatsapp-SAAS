import { AMA, KOFI } from './synthetic-personas';
import { checkFacts, compareStyles, measureReply, normalizeMoney, priceTokens, type StyleMetrics } from './style-compare.util';

const metrics = (texts: string[]): StyleMetrics[] => texts.map((t) => measureReply(t)!);

describe('compareStyles', () => {
  it('tells two different agents apart on several dimensions', () => {
    const result = compareStyles(metrics(AMA), metrics(KOFI));
    expect(result.distinguishable).toBe(true);
    expect(result.differing).toEqual(expect.arrayContaining(['length', 'energy', 'follow-up questions']));
  });
  it('does not call one agent\'s replies different from themselves', () => {
    expect(compareStyles(metrics(AMA.slice(0, 6)), metrics(AMA.slice(6))).distinguishable).toBe(false);
    expect(compareStyles(metrics(KOFI.slice(0, 6)), metrics(KOFI.slice(6))).distinguishable).toBe(false);
  });
  it('one differing dimension is not enough', () => {
    const plain = metrics(['The red shirt is available.', 'It costs GH₵50.']);
    const withEmoji = metrics(['The red shirt is available 😊', 'It costs GH₵50 😊']);
    expect(compareStyles(plain, withEmoji)).toMatchObject({ differing: ['emoji'], distinguishable: false });
  });
});

describe('prices', () => {
  it('normalises the same price written different ways', () => {
    for (const t of ['GH₵50', 'GH₵ 50.00', 'GHS50', 'ghs 50']) expect(normalizeMoney(t)).toBe('GH₵50');
    expect(normalizeMoney('GH₵1,050.00')).toBe('GH₵1050');
  });
  it('finds prices in prose', () => {
    expect(priceTokens('It is GH₵50 or 120 cedis, delivery $5.50')).toEqual(['GH₵50', '120CEDIS', '$5.50']);
  });
});

describe('checkFacts', () => {
  const rules = { mustContain: ['red shirt', 'GH₵50'], mustNotContain: ['discount', 'free delivery'], allowedPrices: ['GH₵50'] };
  it('passes a reply that states only catalogue facts, in any style', () => {
    expect(checkFacts('Sure! The Red Shirt is GH₵50 😊 Which size?', rules)).toEqual([]);
    expect(checkFacts('Red shirt. GH₵ 50.00.', rules)).toEqual([]);
  });
  it('catches an invented price, an invented promotion and a missing fact', () => {
    expect(checkFacts('The red shirt is GH₵40 today, GH₵50 normally.', rules)).toEqual(['price not in the catalogue: GH₵40']);
    expect(checkFacts('Red shirt GH₵50, and I can offer a discount.', rules)).toEqual(['contains forbidden "discount"']);
    expect(checkFacts('We have shirts.', rules)).toEqual(expect.arrayContaining(['missing "red shirt"', 'missing "GH₵50"']));
  });
});
