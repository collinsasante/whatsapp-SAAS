import { buildLearningDisclosure, currentDisclosureVersion } from './learning-disclosure';
import { isLearningPermitted, learningBlockReason } from './learning-eligibility';
import { loadRetentionSettings } from './learning-retention.service';

const OFF = loadRetentionSettings({});
const ON = loadRetentionSettings({ AI_LEARNING_RETENTION_ENABLED: 'true' });
const text = (d: ReturnType<typeof buildLearningDisclosure>) => [d.title, d.summary, ...d.sections.flatMap((s) => [s.heading, ...s.points])].join('\n');

describe('learning disclosure', () => {
  it('covers what an administrator must understand, in plain sections that each have content', () => {
    const d = buildLearningDisclosure(OFF);
    expect(d.sections.map((s) => s.id)).toEqual(['collected', 'how', 'retention', 'guidance', 'controls']);
    for (const s of d.sections) { expect(s.heading.length).toBeGreaterThan(3); expect(s.points.length).toBeGreaterThan(0); }
    const all = text(d).toLowerCase();
    expect(all).toContain('background');                 // asynchronous evaluation
    expect(all).toContain('deepseek');                   // who receives the excerpt
    expect(all).toContain('off by default');             // disabled by default
    expect(all).toContain('pause');                      // independent pause
    expect(all).toContain('approved guidance');          // independent guidance switch
    expect(all).toMatch(/never taken from your ai credits/);
    expect(all).toMatch(/identifiers, counts and settings only, never conversation content/);
  });

  it('is honest that interaction records exist whether or not learning is on, and that learning only reads them', () => {
    const collected = buildLearningDisclosure(OFF).sections.find((s) => s.id === 'collected')!;
    expect(collected.points[0]).toMatch(/whether or not learning is on/);
    expect(collected.points[0]).toMatch(/Learning does not create these records; it reads them/);
    expect(text(buildLearningDisclosure(OFF))).toMatch(/including the interaction records your AI log uses/);
  });

  it('says that switching learning off or pausing it does not delete what was already collected', () => {
    const controls = buildLearningDisclosure(OFF).sections.find((s) => s.id === 'controls')!;
    expect(controls.points.join(' ')).toMatch(/does not delete what was already collected/);
  });

  it('states the size of what is sent to the provider', () => {
    expect(text(buildLearningDisclosure(OFF))).toMatch(/up to about 9,000 characters/);
  });

  it('has a stable content-hash version, and the same input always gives the same one', () => {
    expect(buildLearningDisclosure(OFF).version).toMatch(/^d1-[0-9a-f]{12}$/);
    expect(buildLearningDisclosure(OFF).version).toBe(buildLearningDisclosure(OFF).version);
  });

  it('a retention change is a NEW version, so every workspace must acknowledge again', () => {
    const versions = new Set([
      buildLearningDisclosure(OFF).version,
      buildLearningDisclosure(ON).version,
      buildLearningDisclosure(loadRetentionSettings({ AI_LEARNING_RETENTION_ENABLED: 'true', AI_LEARNING_RETENTION_FREE_TEXT_DAYS: '30' })).version,
      buildLearningDisclosure(loadRetentionSettings({ AI_LEARNING_RETENTION_ENABLED: 'true', AI_LEARNING_RETENTION_METRICS_MONTHS: '6' })).version,
    ]);
    expect(versions.size).toBe(4);
  });

  it('is honest about retention: while automatic deletion is off it promises no period', () => {
    const off = text(buildLearningDisclosure(OFF));
    expect(off).toMatch(/Automatic deletion is not switched on yet/);
    expect(off).not.toMatch(/\b90 days\b/);
    expect(off).not.toMatch(/\b13 months\b/);
    const on = text(buildLearningDisclosure(ON));
    expect(on).toMatch(/deleted 90 days after/);
    expect(on).toMatch(/deleted 13 months after/);
    expect(on).not.toMatch(/not switched on yet/);
  });

  it('says plainly that approved examples are not deleted automatically, and that deleting a conversation removes what was learned from it', () => {
    const on = text(buildLearningDisclosure(ON));
    expect(on).toMatch(/Approved training examples are not deleted automatically/);
    expect(on).toMatch(/everything learned from it is deleted in the same step/);
  });

  it('contains no secrets, environment variable names or internal identifiers', () => {
    expect(text(buildLearningDisclosure(ON))).not.toMatch(/AI_LEARNING|_SECRET|API_KEY|password|token/i);
  });

  it('currentDisclosureVersion follows the live retention settings', () => {
    expect(currentDisclosureVersion(OFF)).toBe(buildLearningDisclosure(OFF).version);
    expect(currentDisclosureVersion(ON)).not.toBe(currentDisclosureVersion(OFF));
  });
});

describe('isLearningPermitted / learningBlockReason', () => {
  const V = 'd1-current';
  const row = (over: Partial<{ learningEnabled: boolean; learningPaused: boolean; disclosureVersion: string | null }> = {}) => ({ learningEnabled: true, learningPaused: false, disclosureVersion: V, ...over });

  it('permits only an opted-in, unpaused workspace that acknowledged the CURRENT version', () => {
    expect(isLearningPermitted(row(), V)).toBe(true);
    expect(learningBlockReason(row(), V)).toBeNull();
  });

  it.each([
    ['no settings row', null, 'not_enabled'],
    ['not opted in', row({ learningEnabled: false }), 'not_enabled'],
    ['opted out even with a current acknowledgement', row({ learningEnabled: false, disclosureVersion: V }), 'not_enabled'],
    ['no acknowledgement recorded', row({ disclosureVersion: null }), 'disclosure_outdated'],
    ['an outdated acknowledgement', row({ disclosureVersion: 'd1-old' }), 'disclosure_outdated'],
    ['paused', row({ learningPaused: true }), 'paused'],
  ] as const)('refuses %s', (_label, settings, reason) => {
    expect(isLearningPermitted(settings, V)).toBe(false);
    expect(learningBlockReason(settings, V)).toBe(reason);
  });

  it('an outdated acknowledgement is reported ahead of a pause, so resuming cannot skip the new notice', () => {
    expect(learningBlockReason(row({ learningPaused: true, disclosureVersion: 'd1-old' }), V)).toBe('disclosure_outdated');
  });
});
