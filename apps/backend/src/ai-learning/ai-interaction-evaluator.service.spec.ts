import axios from 'axios';
import { AiInteractionEvaluatorService, TransientJudgeError } from './ai-interaction-evaluator.service';
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

  describe('retry policy: one provider call per evaluation; only explicitly transient failures are retryable', () => {
    const httpError = (status: number) => Object.assign(new Error(`status ${status}`), { response: { status } });
    const netError = (code: string) => Object.assign(new Error(code), { code });

    it.each([400, 401, 402, 403, 404, 408, 422, 429])('treats HTTP %i as permanent: null, one call, no retry', async (status) => {
      mockedAxios.post.mockRejectedValue(httpError(status));
      await expect(service.evaluate(buildContext())).resolves.toBeNull();
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    });

    it.each([500, 502, 503, 504])('treats HTTP %i as transient: throws TransientJudgeError after exactly one call', async (status) => {
      mockedAxios.post.mockRejectedValue(httpError(status));
      await expect(service.evaluate(buildContext())).rejects.toBeInstanceOf(TransientJudgeError);
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    });

    it.each(['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE'])('treats a %s network failure as transient', async (code) => {
      mockedAxios.post.mockRejectedValue(netError(code));
      await expect(service.evaluate(buildContext())).rejects.toBeInstanceOf(TransientJudgeError);
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    });

    it.each([['an unclassified error', new Error('timeout')], ['an unknown code', netError('EWHATEVER')], ['501 Not Implemented', httpError(501)], ['a non-error value', 'boom']])(
      'treats %s as permanent (not on the explicit retry list)', async (_l, err) => {
        mockedAxios.post.mockRejectedValue(err);
        await expect(service.evaluate(buildContext())).resolves.toBeNull();
        expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      });

    it.each([['empty content', ''], ['whitespace content', '   '], ['malformed JSON', 'not json'], ['no usable dimensions', '{"dimensions":{}}']])('does not retry %s', async (_l, content) => {
      mockedAxios.post.mockResolvedValue({ data: { choices: [{ message: { content } }] } });
      await expect(service.evaluate(buildContext())).resolves.toBeNull();
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    });

    it('does not retry a response with no choices at all', async () => {
      mockedAxios.post.mockResolvedValue({ data: {} });
      await expect(service.evaluate(buildContext())).resolves.toBeNull();
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    });

    it('never logs the request configuration (it carries the Authorization header) when a call fails', async () => {
      const warn = jest.spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation(() => undefined);
      mockedAxios.post.mockRejectedValue(Object.assign(new Error('401'), { response: { status: 401 }, config: { headers: { Authorization: 'Bearer test-key' } } }));
      await service.evaluate(buildContext());
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).not.toContain('test-key');
      expect(warn.mock.calls[0][0]).toContain('HTTP 401');
    });

    it('the request is the unchanged one-shot shape', async () => {
      mockJudgeResponse({ dimensions: { accuracy: 5 }, confidence: 0.9 });
      await service.evaluate(buildContext());
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(mockedAxios.post.mock.calls[0][1]).toMatchObject({ model: 'deepseek-v4-flash', max_tokens: 500, response_format: { type: 'json_object' } });
    });
  });
});
