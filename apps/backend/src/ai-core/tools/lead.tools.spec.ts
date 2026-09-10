import { buildLeadTools } from './lead.tools';

const ctx = { tenantId: 't1', conversationId: 'c1', contactId: 'ct1', customerPhone: '+233555000111' };

describe('lead.tools', () => {
  it('force-scores and returns only staff-safe fields, withholding reasoningSummary', async () => {
    const leads = {
      scoreConversation: jest.fn().mockResolvedValue({
        score: 85, status: 'HOT', intent: 'wants labels', urgencySignal: 'by Friday', budgetSignal: null,
        productInterest: 'labels', recommendedNextAction: 'send quote', reasoningSummary: 'internal-only detail',
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tool = buildLeadTools(leads as any).find((t) => t.def.name === 'qualify_lead')!;

    const result = await tool.execute(ctx, {});

    expect(leads.scoreConversation).toHaveBeenCalledWith('t1', 'c1', 'ct1', { force: true });
    expect(result).toEqual({
      score: 85, status: 'HOT', intent: 'wants labels', urgencySignal: 'by Friday',
      budgetSignal: null, productInterest: 'labels', recommendedNextAction: 'send quote',
    });
    expect(result).not.toHaveProperty('reasoningSummary');
  });

  it('returns an error result when scoring fails', async () => {
    const leads = { scoreConversation: jest.fn().mockResolvedValue(null) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tool = buildLeadTools(leads as any).find((t) => t.def.name === 'qualify_lead')!;

    const result = await tool.execute(ctx, {});

    expect(result).toEqual({ error: 'Could not qualify this lead right now' });
  });
});
