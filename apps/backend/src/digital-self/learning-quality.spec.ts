import { extractFeatures, type MessageFeatures } from './message-features.util';
import { emptyProfile, formatStyleBlock, mergeFeatures, summarizeProfile, type WeightedFeatures } from './profile.util';
import { MAX_STYLE_BLOCK_CHARS } from './digital-self.constants';
import { AMA, KOFI, PIDGIN_MIX } from './validation/synthetic-personas';

const features = (texts: string[], cycles = 3): MessageFeatures[] => Array.from({ length: cycles }, () => texts).flat().map((t) => extractFeatures(t)!);
const summary = (texts: string[], cycles = 3) => summarizeProfile(mergeFeatures(emptyProfile(), features(texts, cycles)));

describe('learned style: two agents', () => {
  const ama = summary(AMA);
  const kofi = summary(KOFI);

  it('captures tone, energy and emoji', () => {
    expect(ama).toMatchObject({ warmth: 'enthusiastic', emoji: 'frequent' });
    expect(kofi).toMatchObject({ warmth: 'reserved', emoji: 'none' });
  });

  it('captures typical length and sentence structure', () => {
    expect(kofi.replyLength).toBe('short');
    expect(kofi.sentenceLength).toBe('short');
    expect(ama.averageWords!).toBeGreaterThan(kofi.averageWords!);
  });

  it('captures formality', () => {
    expect(kofi.formality).toBe('formal'); // "Kindly", "Please"
    expect(ama.formality).not.toBe('formal');
  });

  it('captures follow-up habit, acknowledgement and empathy', () => {
    expect(ama).toMatchObject({ followUps: 'often', acknowledges: 'often', empathy: 'often' });
    expect(kofi).toMatchObject({ followUps: 'rarely', acknowledges: 'rarely', empathy: 'rarely' });
  });

  it('captures greeting habit only where one is repeated', () => {
    expect(summary([...AMA, 'Hello! Welcome 😊 How can I help?', 'Hello there! What do you need?', 'Hello! Welcome back 😊 How can I help?', 'Hello! Good to see you again 😊'], 2).opening).toBe('hello');
    expect(kofi.opening).toBeUndefined();
  });

  it('produces visibly different prompt blocks', () => {
    const [a, k] = [formatStyleBlock(ama), formatStyleBlock(kofi)];
    expect(a).not.toEqual(k);
    expect(a).toMatch(/Energy: enthusiastic/);
    expect(k).toMatch(/Register: formal/);
    expect(a).toMatch(/acknowledg/i);
    for (const block of [a, k]) {
      expect(block.length).toBeLessThanOrEqual(MAX_STYLE_BLOCK_CHARS);
      expect(block.endsWith('.')).toBe(true); // never cut mid-line
    }
  });
});

describe('language preferences and code-switching', () => {
  it('detects a Pidgin habit and code-switching from repeated evidence', () => {
    const s = summary([...PIDGIN_MIX, ...PIDGIN_MIX, ...PIDGIN_MIX, 'Okay, noted.', 'Sure.', 'Your order is ready.'], 1);
    expect(s.languages).toContain('pidgin');
    expect(s.codeSwitching).toBe('often');
    expect(formatStyleBlock(s)).toMatch(/Pidgin/);
  });
  it('does not report a language or code-switching from a couple of messages', () => {
    const s = summary([...PIDGIN_MIX.slice(0, 2), ...KOFI], 1);
    expect(s.languages).not.toContain('pidgin');
    expect(s.codeSwitching).toBe('rarely');
  });
  it('reports code-switching for the agent who mixes local expressions, and not for the one who does not', () => {
    expect(summary(AMA).codeSwitching).toBe('often'); // "chale", "small small", "Medaase" in a quarter of her replies
    expect(summary(KOFI).codeSwitching).toBe('rarely');
    expect(summary(AMA).languages).toEqual(expect.arrayContaining(['english']));
  });
});

describe('honesty about what is learned', () => {
  it('exposes no sales, objection or persuasion trait anywhere', () => {
    const keys = Object.keys(summary(AMA)).join(' ').toLowerCase();
    for (const forbidden of ['sales', 'objection', 'persuasion', 'upsell', 'discount']) expect(keys).not.toContain(forbidden);
    expect(formatStyleBlock(summary(AMA)).toLowerCase()).not.toMatch(/objection|persuad|upsell|closing the sale|discount/);
  });

  it('reports nothing before the evidence minimum, however distinctive the few messages are', () => {
    const few = summary(['Hello dear! Welcome 😊 How can I help you today?'], 4);
    expect(few.hasLearnedTraits).toBe(false);
    expect(formatStyleBlock(few)).toBe('');
  });

  it('approved style corrections refine a profile but never stand in for the agent\'s own replies', () => {
    const correction: WeightedFeatures = { features: extractFeatures('Sure! Happy to help 😊 Which size?')!, weight: 3, correction: true };
    const onlyCorrections = summarizeProfile(mergeFeatures(emptyProfile(), [correction, correction, correction, correction]));
    expect(onlyCorrections.hasLearnedTraits).toBe(false);
    expect(onlyCorrections.correctionSamples).toBe(12);
    // With enough own replies the correction then counts, pulling the profile toward the corrected style.
    const base = mergeFeatures(emptyProfile(), features(KOFI, 1));
    const refined = mergeFeatures(base, [correction, correction]);
    expect(summarizeProfile(base).emoji).toBe('none');
    expect(summarizeProfile(refined).emoji).not.toBe('none');
  });
});
