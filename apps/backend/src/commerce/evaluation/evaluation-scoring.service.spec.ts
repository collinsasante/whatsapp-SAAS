import { EvaluationScoringService, EvalTurnRecord } from './evaluation-scoring.service';

function buildService() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new EvaluationScoringService({} as any);
}

function buildTurn(overrides: Partial<EvalTurnRecord> = {}): EvalTurnRecord {
  return {
    customerMessage: 'hi',
    aiResponse: 'Sure, happy to help.',
    blocked: false,
    toolTrace: [],
    mediaToSend: [],
    scriptedTurn: { customerMessage: 'hi' },
    ...overrides,
  };
}

describe('EvaluationScoringService -- Verz-AI unification, Phase K deterministic checks', () => {
  // These checks are purely deterministic (regex-based), but scoreCase() always also runs the
  // LLM-judge payment-claim guard + response_quality scoring -- keep DEEPSEEK_API_KEY unset so
  // those short-circuit to null/neutral defaults instead of depending on network access, matching
  // callJson()'s own `if (!apiKey) return null;` guard.
  const originalKey = process.env.DEEPSEEK_API_KEY;
  beforeEach(() => { delete process.env.DEEPSEEK_API_KEY; });
  afterAll(() => { process.env.DEEPSEEK_API_KEY = originalKey; });

  describe('scoreMediaDelivery (private, exercised via scoreCase)', () => {
    it('passes when a turn scripted with expectMediaSent produced a real send_media side effect', async () => {
      const service = buildService();
      const turns = [buildTurn({
        scriptedTurn: { customerMessage: 'where is the picture?', expectMediaSent: true },
        mediaToSend: [{ type: 'send_media', mediaUrl: 'https://x/img.jpg', mediaType: 'IMAGE' }],
      })];

      const result = await service.scoreCase('t1', { key: 'k', description: '', criteria: ['media_delivery'], products: {}, turns: [] }, turns, [], []);

      expect(result.scores['media_delivery']?.pass).toBe(true);
    });

    it('fails when a turn scripted with expectMediaSent produced no media side effect', async () => {
      const service = buildService();
      const turns = [buildTurn({
        scriptedTurn: { customerMessage: 'where is the picture?', expectMediaSent: true },
        mediaToSend: [],
      })];

      const result = await service.scoreCase('t1', { key: 'k', description: '', criteria: ['media_delivery'], products: {}, turns: [] }, turns, [], []);

      expect(result.scores['media_delivery']?.pass).toBe(false);
      expect(result.scores['media_delivery']?.details[0]).toContain('no send_media side effect');
    });

    it('does not require media on a turn with no expectMediaSent', async () => {
      const service = buildService();
      const turns = [buildTurn({ scriptedTurn: { customerMessage: 'how much is it?' }, mediaToSend: [] })];

      const result = await service.scoreCase('t1', { key: 'k', description: '', criteria: ['media_delivery'], products: {}, turns: [] }, turns, [], []);

      expect(result.scores['media_delivery']?.pass).toBe(true);
    });
  });

  describe('scoreInternalTechNonDisclosure (private, exercised via scoreCase)', () => {
    it.each([
      "I checked my system and we don't have that.",
      'My database shows we have 5 in stock.',
      'Let me run a tool call to check that for you.',
      "That's a DeepSeek limitation, sorry.",
    ])('flags internal-tech language: "%s"', async (aiResponse) => {
      const service = buildService();
      const turns = [buildTurn({ aiResponse })];

      const result = await service.scoreCase('t1', { key: 'k', description: '', criteria: ['internal_tech_non_disclosure'], products: {}, turns: [] }, turns, [], []);

      expect(result.scores['internal_tech_non_disclosure']?.pass).toBe(false);
    });

    it('passes natural, tech-free replies', async () => {
      const service = buildService();
      const turns = [buildTurn({ aiResponse: "Let me get my colleague to check that for you." })];

      const result = await service.scoreCase('t1', { key: 'k', description: '', criteria: ['internal_tech_non_disclosure'], products: {}, turns: [] }, turns, [], []);

      expect(result.scores['internal_tech_non_disclosure']?.pass).toBe(true);
    });
  });
});
