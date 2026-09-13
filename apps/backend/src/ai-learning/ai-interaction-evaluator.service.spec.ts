import axios from 'axios';
import { AiInteractionEvaluatorService } from './ai-interaction-evaluator.service';
import { ResolvedInteractionContext } from './interaction-context.resolver';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function buildContext(overrides: Partial<ResolvedInteractionContext> = {}): ResolvedInteractionContext {
  return {
    conversationId: 'conv-1',
    contactId: 'contact-1',
    customerMessage: 'How much is the 1kg bag?',
    aiResponse: 'The 1kg bag is GHS 25.',
    priorContext: [],
    latestOrderStatus: null,
    handoffTaskExists: false,
    humanOwned: false,
    conversationStatus: 'OPEN',
    ...overrides,
  };
}

function mockJudgeResponse(content: unknown) {
  mockedAxios.post.mockResolvedValue({ data: { choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] } });
}

describe('AiInteractionEvaluatorService', () => {
  let service: AiInteractionEvaluatorService;
  const originalEnv = process.env.DEEPSEEK_API_KEY;

  beforeEach(() => {
    service = new AiInteractionEvaluatorService();
    process.env.DEEPSEEK_API_KEY = 'test-key';
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.DEEPSEEK_API_KEY = originalEnv;
  });

  it('returns null when no API key is configured, without ever calling the network', async () => {
    process.env.DEEPSEEK_API_KEY = '';
    const result = await service.evaluate(buildContext());
    expect(result).toBeNull();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('parses a well-formed judge response into a full evaluation result', async () => {
    mockJudgeResponse({
      dimensions: { contextUnderstanding: 5, accuracy: 5, naturalness: 4 },
      failureCategories: [],
      reasoning: 'Accurate price quote.',
      confidence: 0.9,
      falseActionClaim: false,
      falseSuccessClaim: false,
      unnecessaryHandoff: false,
      customerCorrectionDetected: false,
    });

    const result = await service.evaluate(buildContext());
    expect(result).not.toBeNull();
    expect(result?.overallScore).toBeGreaterThan(0);
    expect(result?.needsHumanReview).toBe(false);
  });

  it('drops a hallucinated dimension key and an out-of-taxonomy failure category rather than persisting them', async () => {
    mockJudgeResponse({
      dimensions: { contextUnderstanding: 5, madeUpDimension: 3 },
      failureCategories: ['MADE_UP_CATEGORY', 'WRONG_PRICE'],
      reasoning: 'x',
      confidence: 0.8,
    });

    const result = await service.evaluate(buildContext());
    expect(result?.dimensions).toEqual({ contextUnderstanding: 5 });
    expect(result?.failureCategories).toEqual(['WRONG_PRICE']);
  });

  it('clamps out-of-range scores into [0, 5]', async () => {
    mockJudgeResponse({ dimensions: { accuracy: 99, naturalness: -3 }, confidence: 0.8 });
    const result = await service.evaluate(buildContext());
    expect(result?.dimensions.accuracy).toBe(5);
    expect(result?.dimensions.naturalness).toBe(0);
  });

  it('returns null for malformed JSON rather than throwing', async () => {
    mockJudgeResponse('not valid json {{{');
    const result = await service.evaluate(buildContext());
    expect(result).toBeNull();
  });

  it('returns null when the response has no usable dimension scores at all', async () => {
    mockJudgeResponse({ dimensions: {}, confidence: 0.8 });
    const result = await service.evaluate(buildContext());
    expect(result).toBeNull();
  });

  it('flags needsHumanReview when the judge detects a false success claim', async () => {
    mockJudgeResponse({
      dimensions: { accuracy: 4 },
      falseSuccessClaim: true,
      confidence: 0.9,
    });
    const result = await service.evaluate(buildContext());
    expect(result?.needsHumanReview).toBe(true);
    expect(result?.falseSuccessClaim).toBe(true);
  });

  it('retries once on a network failure before giving up', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('timeout'));
    mockedAxios.post.mockResolvedValueOnce({ data: { choices: [{ message: { content: JSON.stringify({ dimensions: { accuracy: 5 }, confidence: 0.9 }) } }] } });

    const result = await service.evaluate(buildContext());
    expect(result).not.toBeNull();
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });
});
