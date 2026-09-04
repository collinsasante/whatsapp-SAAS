import { ChatbotFlowsService } from './chatbot-flows.service';

function buildPrismaMock() {
  return { chatbotFlow: { findMany: jest.fn() } };
}

function flow(overrides: Partial<{ id: string; trigger: string; keywords: string[]; priority: number }>) {
  return { id: 'flow-1', trigger: 'KEYWORD', keywords: [], priority: 0, nodes: [], ...overrides };
}

describe('ChatbotFlowsService.findMatchingFlow', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: ChatbotFlowsService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new ChatbotFlowsService(prisma as any);
  });

  it('matches a KEYWORD flow regardless of message position', async () => {
    prisma.chatbotFlow.findMany.mockResolvedValue([flow({ id: 'kw', trigger: 'KEYWORD', keywords: ['pricing'] })]);

    const result = await service.findMatchingFlow('t1', 'what is your pricing', false);

    expect(result?.id).toBe('kw');
  });

  it('only matches FIRST_MESSAGE on the actual first message, not every message', async () => {
    prisma.chatbotFlow.findMany.mockResolvedValue([flow({ id: 'fm', trigger: 'FIRST_MESSAGE' })]);

    const first = await service.findMatchingFlow('t1', 'hi', true);
    const second = await service.findMatchingFlow('t1', 'hi again', false);

    expect(first?.id).toBe('fm');
    expect(second).toBeNull();
  });

  it('only returns a FALLBACK flow after no KEYWORD/FIRST_MESSAGE flow matched', async () => {
    prisma.chatbotFlow.findMany.mockResolvedValue([
      flow({ id: 'kw', trigger: 'KEYWORD', keywords: ['refund'], priority: 10 }),
      flow({ id: 'fb', trigger: 'FALLBACK', priority: 5 }),
    ]);

    const keywordHit = await service.findMatchingFlow('t1', 'I want a refund', false);
    const fallbackHit = await service.findMatchingFlow('t1', 'something unrelated', false);

    expect(keywordHit?.id).toBe('kw');
    expect(fallbackHit?.id).toBe('fb');
  });

  it('does not let FALLBACK preempt a lower-priority KEYWORD flow', async () => {
    prisma.chatbotFlow.findMany.mockResolvedValue([
      flow({ id: 'fb', trigger: 'FALLBACK', priority: 10 }),
      flow({ id: 'kw', trigger: 'KEYWORD', keywords: ['order'], priority: 5 }),
    ]);

    const result = await service.findMatchingFlow('t1', 'where is my order', false);

    expect(result?.id).toBe('kw');
  });

  it('returns null when nothing matches and there is no fallback', async () => {
    prisma.chatbotFlow.findMany.mockResolvedValue([flow({ id: 'kw', trigger: 'KEYWORD', keywords: ['refund'] })]);

    const result = await service.findMatchingFlow('t1', 'random message', false);

    expect(result).toBeNull();
  });
});
