/**
 * Conversation-quality evaluation (CI-safe: mocked database and model provider, REAL production classes -- see harness.ts).
 * Every scenario in scenarios.ts is run through each generator it lists, and its expected outcome is checked.
 */
import axios from 'axios';
import { GENERATORS, Generator, Observed, Scenario, run } from './harness';
import { SCENARIOS } from './scenarios';

jest.mock('axios');

const cases = SCENARIOS.flatMap((s) => s.generators.map((g) => [`${s.category} / ${s.id}`, g, s] as [string, Generator, Scenario]));

function expectResponse(actual: string, want: string | RegExp | undefined): void {
  if (want === undefined) return;
  if (typeof want === 'string') expect(actual).toBe(want);
  else expect(actual).toMatch(want);
}

describe('conversation quality scenarios', () => {
  it('covers at least 30 distinct scenarios across all three generators', () => {
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(30);
    for (const g of GENERATORS) expect(SCENARIOS.some((s) => s.generators.includes(g))).toBe(true);
  });

  it.each(cases)('%s [%s]', async (_name, generator, scenario) => {
    const seen: Observed = await run(generator, scenario);
    const want = scenario.expect;

    const turns = want.turnsBy?.[generator] ?? want.turns;
    if (turns !== undefined) expect(seen.turns).toEqual(turns);

    if (want.modelCalled !== undefined) expect(seen.modelCalled).toBe(want.modelCalled);
    if (want.blocked !== undefined) expect(seen.blocked).toBe(want.blocked);
    if (want.kbNone) expect(seen.kbTitles).toEqual([]);
    if (want.kbTitles) expect(seen.kbTitles).toEqual(want.kbTitles);
    if (want.kbTopAnyOf) {
      // The named articles are the best matches, in any order, and nothing outranks them.
      expect(seen.kbTitles.slice(0, want.kbTopAnyOf.length).sort()).toEqual([...want.kbTopAnyOf].sort());
    }
    for (const needle of want.systemIncludes ?? []) expect(seen.system).toMatch(typeof needle === 'string' ? new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : needle);
    for (const needle of want.systemExcludes ?? []) expect(seen.system).not.toMatch(typeof needle === 'string' ? new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : needle);
    expectResponse(seen.response, want.responseBy?.[generator] ?? want.response);
    const escalate = want.escalateBy?.[generator] ?? want.escalate;
    if (escalate !== undefined) expect(seen.escalate).toBe(escalate);
  });

  afterAll(() => {
    (axios.post as jest.Mock).mockReset();
  });
});
