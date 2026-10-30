import { NATURAL_TONE_RULES, SHARED_STYLE_RULES } from './shared-style-rules';

describe('shared style rules', () => {
  it('NATURAL_TONE_RULES are tool-agnostic and appear, in order, inside SHARED_STYLE_RULES (v2 and Commerce)', () => {
    const joined = NATURAL_TONE_RULES.join('\n');
    expect(SHARED_STYLE_RULES).toContain(joined);
    expect(joined).not.toMatch(/\btool\b|handoff|hand off/i);
  });
  it('still opens with the STYLE heading and the short-reply rule, and keeps the tool-aware rules after the tone rules', () => {
    expect(SHARED_STYLE_RULES.startsWith('STYLE:\n- Keep replies short and conversational')).toBe(true);
    expect(SHARED_STYLE_RULES.indexOf(NATURAL_TONE_RULES[0]!)).toBeLessThan(SHARED_STYLE_RULES.indexOf('Never describe an action as done'));
  });
});
