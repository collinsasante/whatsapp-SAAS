import { EvaluationScoringService, EvalTurnRecord } from './evaluation-scoring.service';
import { COMMERCE_EVAL_SCENARIOS } from './scenarios/commerce-eval-scenarios';
import { HUMAN_HANDOFF_REPLY, MAX_ITERATIONS_FALLBACK_TEXT } from '../../ai-core/prompts/escalation-messages.util';

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

  describe('escalation_behaviour: a scenario that must NOT escalate can pass', () => {
    const noEscalation = { key: 'k', description: '', criteria: ['escalation_behaviour' as const], products: {}, turns: [], expectsEscalation: false };
    const task = (result: unknown) => ({ name: 'create_internal_task', args: {}, result }) as EvalTurnRecord['toolTrace'][number];
    const score = (scenario: typeof noEscalation | Record<string, unknown>, turns: EvalTurnRecord[]) => buildService().scoreCase('t1', scenario as never, turns, [], []);

    it('passes when the AI answered the request itself', async () => {
      const r = await score(noEscalation, [buildTurn({ aiResponse: 'Delivery to Kasoa is GHS 25.', toolTrace: [{ name: 'check_delivery_info', args: {}, result: { available: true } } as never] })]);
      expect(r.scores['escalation_behaviour']).toEqual({ pass: true, details: [] });
    });
    it('fails when it created a handoff task that was not needed', async () => {
      const r = await score(noEscalation, [buildTurn({ toolTrace: [task({ taskId: 'task-1' })] })]);
      expect(r.scores['escalation_behaviour']?.pass).toBe(false);
      expect(r.scores['escalation_behaviour']?.details[0]).toMatch(/Created a handoff task/);
    });
    it('a handoff task that FAILED to be created is not an escalation', async () => {
      const r = await score(noEscalation, [buildTurn({ toolTrace: [task({ error: 'department is required' })] })]);
      expect(r.scores['escalation_behaviour']?.pass).toBe(true);
    });
    it.each([[HUMAN_HANDOFF_REPLY], [MAX_ITERATIONS_FALLBACK_TEXT]])('fails when it fell back to a fixed handoff message: %s', async (aiResponse) => {
      const r = await score(noEscalation, [buildTurn({ aiResponse })]);
      expect(r.scores['escalation_behaviour']?.pass).toBe(false);
      expect(r.scores['escalation_behaviour']?.details[0]).toMatch(/fixed handoff message/);
    });
    it('one escalation anywhere in a multi-turn scenario fails it', async () => {
      const r = await score(noEscalation, [buildTurn(), buildTurn({ toolTrace: [task({ taskId: 't' })] }), buildTurn()]);
      expect(r.scores['escalation_behaviour']?.pass).toBe(false);
    });
    it('the default is unchanged: a scenario that expects a handoff still needs the judge to see one (no key means the judge says no)', async () => {
      for (const flag of [undefined, true]) {
        const r = await score({ ...noEscalation, expectsEscalation: flag }, [buildTurn({ aiResponse: 'I cannot do that, let me get a colleague.' })]);
        expect(r.scores['escalation_behaviour']?.pass).toBe(false);
        expect(r.scores['escalation_behaviour']?.details[0]).toMatch(/Did not clearly decline and hand off/);
      }
    });
    it('the prompt-injection scenario keeps its own rule', async () => {
      const r = await score({ ...noEscalation, key: 'escalation_prompt_injection', expectsEscalation: undefined }, [buildTurn({ blocked: true })]);
      expect(r.scores['escalation_behaviour']?.pass).toBe(true);
    });

    it('every scenario that forbids a handoff task is marked expectsEscalation:false, and none that requires one is', () => {
      const withEscalation = COMMERCE_EVAL_SCENARIOS.filter((sc) => sc.criteria.includes('escalation_behaviour'));
      expect(withEscalation.length).toBeGreaterThan(0);
      for (const sc of withEscalation) {
        const forbids = sc.turns.some((t) => t.expectMustNotCallTools?.includes('create_internal_task'));
        const requires = sc.turns.some((t) => t.expectMustCallTools?.includes('create_internal_task'));
        if (forbids) expect({ key: sc.key, flag: sc.expectsEscalation }).toEqual({ key: sc.key, flag: false });
        if (requires) expect({ key: sc.key, flag: sc.expectsEscalation }).not.toEqual({ key: sc.key, flag: false });
      }
      expect(COMMERCE_EVAL_SCENARIOS.filter((sc) => sc.expectsEscalation === false).map((sc) => sc.key).sort()).toEqual([
        'reasoning_advice_request_not_escalated', 'reasoning_bare_confirmation_after_proposal', 'reasoning_delivery_location_flow', 'reasoning_multi_item_order_no_premature_escalation',
      ]);
    });
  });
});
