import { readFileSync } from 'fs';
import { join } from 'path';
import { LEARNING_PRICE_TABLE, costMicros } from './learning-price-table';
import { PER_MESSAGE_TOKEN_ALLOWANCE, PER_REQUEST_TOKEN_ALLOWANCE, estimateInputTokensUpperBound } from './estimate-input-tokens.util';
import { DEFAULT_LEARNING_COST_CONFIG, loadLearningCostConfig, usdToMicros } from '../learning-cost.config';
import { LEARNING_MAX_OUTPUT_TOKENS } from '../learning-queue.constants';

describe('learning price table', () => {
  it('records the agreed peak cache-miss rates, a version, a verification date and a source', () => {
    expect(LEARNING_PRICE_TABLE).toMatchObject({ inputMicrosPerMillionTokens: 300_000, outputMicrosPerMillionTokens: 1_200_000, verifiedAt: '2026-11-02' });
    expect(LEARNING_PRICE_TABLE.version).toMatch(/peak-cache-miss/);
    expect(LEARNING_PRICE_TABLE.source).toMatch(/^https:\/\/api-docs\.deepseek\.com\//);
  });

  it('prices exactly one million tokens at the table rate', () => {
    expect(costMicros(1_000_000, 0)).toBe(300_000n); // USD 0.30
    expect(costMicros(0, 1_000_000)).toBe(1_200_000n); // USD 1.20
    expect(costMicros(1_000_000, 1_000_000)).toBe(1_500_000n);
  });

  it('rounds UP to a whole micro-USD, so a cost is never under-counted', () => {
    expect(costMicros(1, 0)).toBe(1n); // 0.3 micro-USD -> 1
    expect(costMicros(0, 1)).toBe(2n); // 1.2 -> 2
    expect(costMicros(0, 0)).toBe(0n);
  });

  it('treats negative, fractional and non-finite token counts safely (never negative, never throws)', () => {
    expect(costMicros(-5, -5)).toBe(0n);
    expect(costMicros(Number.NaN, Number.POSITIVE_INFINITY)).toBe(0n);
    expect(costMicros(10.9, 0)).toBe(costMicros(10, 0));
  });
});

describe('estimateInputTokensUpperBound', () => {
  const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
  const samples: Record<string, string> = {
    english: 'Hello, where is my order? I paid yesterday.',
    emoji: '😀😃😄 thanks 🙏🏾 👨‍👩‍👧‍👦 🇬🇭',
    twi: 'Mepɛ sɛ mehu me order no. Ɛyɛ den! Meda wo ase.',
    arabic: 'أين طلبي؟ لقد دفعت أمس وما زلت أنتظر',
    chinese: '我的订单在哪里？我昨天已经付款了。',
    hindi: 'मेरा ऑर्डर कहाँ है? मैंने कल भुगतान किया था।',
    combining: 'é'.repeat(50),
    emptyish: '',
  };

  it.each(Object.entries(samples))('is at least the UTF-8 byte length plus the allowances: %s', (_name, text) => {
    const messages = [{ content: text }];
    expect(estimateInputTokensUpperBound(messages)).toBe(PER_REQUEST_TOKEN_ALLOWANCE + bytes(text) + PER_MESSAGE_TOKEN_ALLOWANCE);
  });

  it.each(Object.entries(samples))('is at least the number of code points and of UTF-16 units (the worst plausible tokenizers): %s', (_name, text) => {
    const estimate = estimateInputTokensUpperBound([{ content: text }]);
    expect(estimate).toBeGreaterThanOrEqual([...text].length);
    expect(estimate).toBeGreaterThanOrEqual(text.length);
  });

  it('adds up every message', () => {
    const one = estimateInputTokensUpperBound([{ content: 'abc' }]);
    const two = estimateInputTokensUpperBound([{ content: 'abc' }, { content: 'abc' }]);
    expect(two - one).toBe(3 + PER_MESSAGE_TOKEN_ALLOWANCE);
  });

  it('keeps a typical judge request far under the per-run cap, and rejects an enormous one', () => {
    const reservation = (chars: number) => costMicros(estimateInputTokensUpperBound([{ content: 'x'.repeat(chars) }]), LEARNING_MAX_OUTPUT_TOKENS);
    expect(reservation(8_000)).toBeLessThan(DEFAULT_LEARNING_COST_CONFIG.maxReservationMicros);
    expect(reservation(400_000)).toBeGreaterThan(DEFAULT_LEARNING_COST_CONFIG.maxReservationMicros);
  });
});

describe('learning cost configuration', () => {
  it('defaults to USD 5 per workspace, USD 50 globally and USD 0.05 per run', () => {
    expect(loadLearningCostConfig({})).toEqual({ workspaceMonthlyBudgetMicros: 5_000_000n, globalMonthlyBudgetMicros: 50_000_000n, maxReservationMicros: 50_000n });
  });

  it('reads overrides from the environment and ignores invalid values', () => {
    expect(loadLearningCostConfig({ AI_LEARNING_WORKSPACE_MONTHLY_BUDGET_USD: '2.5', AI_LEARNING_GLOBAL_MONTHLY_BUDGET_USD: 'abc', AI_LEARNING_MAX_RESERVATION_USD: '-1' }))
      .toEqual({ workspaceMonthlyBudgetMicros: 2_500_000n, globalMonthlyBudgetMicros: 50_000_000n, maxReservationMicros: 50_000n });
    expect(usdToMicros('0.05')).toBe(50_000n);
    expect(usdToMicros('')).toBeNull();
  });
});

describe('credit isolation (static)', () => {
  it('the learning ledger does not import or reference any customer AI credit code', () => {
    for (const file of ['learning-cost.service.ts', 'learning-cost.config.ts', 'pricing/learning-price-table.ts']) {
      // Comments may explain the isolation by naming the credit classes; only executable code is checked.
      const source = readFileSync(join(__dirname, '..', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(source).not.toMatch(/AiCredit|AiMeteredProvider|AiPricing|aiCredits|creditTransaction/i);
    }
  });
});
