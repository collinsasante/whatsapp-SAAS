import { DigitalSelfStatus } from '@prisma/client';
import {
  MAX_STYLE_BLOCK_CHARS,
  MIN_ATTRIBUTE_SAMPLES,
  OVERRIDE_OPTIONS,
  PROFILE_SCHEMA_VERSION,
  PROFILE_WINDOW,
  READY_SAMPLES,
  STALE_AFTER_DAYS,
} from './digital-self.constants';
import type { MessageFeatures } from './message-features.util';

export type ProfileOverrides = { [K in keyof typeof OVERRIDE_OPTIONS]?: (typeof OVERRIDE_OPTIONS)[K][number] };

/** Incremental accumulators, not text. The counters are windowed (see mergeFeatures); `overrides` are business corrections. */
export interface DigitalSelfProfile {
  v: number;
  /** Weighted number of messages behind the counters. */
  samples: number;
  /** The part of `samples` that came from approved style corrections rather than the agent's own replies. */
  correctionSamples: number;
  words: number;
  sentences: number;
  endQuestions: number;
  exclaims: number;
  emojis: number;
  contractions: number;
  formal: number;
  casual: number;
  empathy: number;
  acknowledgements: number;
  codeSwitches: number;
  lowercaseStarts: number;
  greetings: Record<string, number>;
  closings: Record<string, number>;
  languages: Record<string, number>;
  overrides: ProfileOverrides;
}

const COUNTERS = ['samples', 'correctionSamples', 'words', 'sentences', 'endQuestions', 'exclaims', 'emojis', 'contractions', 'formal', 'casual', 'empathy', 'acknowledgements', 'codeSwitches', 'lowercaseStarts'] as const;

export function emptyProfile(): DigitalSelfProfile {
  return { v: PROFILE_SCHEMA_VERSION, samples: 0, correctionSamples: 0, words: 0, sentences: 0, endQuestions: 0, exclaims: 0, emojis: 0, contractions: 0, formal: 0, casual: 0, empathy: 0, acknowledgements: 0, codeSwitches: 0, lowercaseStarts: 0, greetings: {}, closings: {}, languages: {}, overrides: {} };
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const counts = (v: unknown): Record<string, number> => {
  if (!v || typeof v !== 'object') return {};
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, n]) => num(n) > 0).map(([k, n]) => [k, num(n)]));
};

/** Reads stored JSON defensively: a malformed or future-shaped value becomes an empty profile rather than an exception on the reply path. */
export function parseProfile(raw: unknown): DigitalSelfProfile {
  if (!raw || typeof raw !== 'object') return emptyProfile();
  const r = raw as Record<string, unknown>;
  if (r['v'] !== PROFILE_SCHEMA_VERSION) return emptyProfile();
  const overrides: ProfileOverrides = {};
  const o = r['overrides'] && typeof r['overrides'] === 'object' ? (r['overrides'] as Record<string, unknown>) : {};
  for (const key of Object.keys(OVERRIDE_OPTIONS) as Array<keyof typeof OVERRIDE_OPTIONS>) {
    const allowed: readonly string[] = OVERRIDE_OPTIONS[key];
    if (typeof o[key] === 'string' && allowed.includes(o[key] as string)) (overrides as Record<string, string>)[key] = o[key] as string;
  }
  const out = emptyProfile();
  for (const key of COUNTERS) out[key] = num(r[key]);
  out.greetings = counts(r['greetings']);
  out.closings = counts(r['closings']);
  out.languages = counts(r['languages']);
  out.overrides = overrides;
  return out;
}

/** One contribution to a profile. `weight` > 1 lets an approved correction count for more than one reply; `correction` keeps it out of the evidence gate. */
export interface WeightedFeatures {
  features: MessageFeatures;
  weight: number;
  correction?: boolean;
}

const bump = (map: Record<string, number>, key: string | null, by: number) => {
  if (key) map[key] = (map[key] ?? 0) + by;
};

/** Adds contributions to the accumulators. Past PROFILE_WINDOW everything is scaled down proportionally, a cheap exponential
 * forgetting: recent habits count more and a single odd message moves a mature profile by at most 1/WINDOW. */
export function mergeFeatures(profile: DigitalSelfProfile, batch: Array<MessageFeatures | WeightedFeatures>): DigitalSelfProfile {
  const next: DigitalSelfProfile = { ...profile, greetings: { ...profile.greetings }, closings: { ...profile.closings }, languages: { ...profile.languages }, overrides: { ...profile.overrides } };
  for (const item of batch) {
    const { features: f, weight, correction } = 'features' in item ? item : { features: item, weight: 1, correction: false };
    next.samples += weight;
    if (correction) next.correctionSamples += weight;
    next.words += f.words * weight;
    next.sentences += f.sentences * weight;
    if (f.endsWithQuestion) next.endQuestions += weight;
    if (f.hasExclaim) next.exclaims += weight;
    if (f.hasEmoji) next.emojis += weight;
    if (f.hasContraction) next.contractions += weight;
    if (f.empathy) next.empathy += weight;
    if (f.acknowledges) next.acknowledgements += weight;
    if (f.codeSwitch) next.codeSwitches += weight;
    if (f.lowercaseStart) next.lowercaseStarts += weight;
    next.formal += f.formalMarkers * weight;
    next.casual += f.casualMarkers * weight;
    bump(next.greetings, f.greeting, weight);
    bump(next.closings, f.closing, weight);
    for (const lang of f.languages) bump(next.languages, lang, weight);
  }
  if (next.samples > PROFILE_WINDOW) {
    const k = PROFILE_WINDOW / next.samples;
    for (const key of COUNTERS) next[key] *= k;
    for (const map of [next.greetings, next.closings, next.languages]) for (const key of Object.keys(map)) map[key] *= k;
  }
  return next;
}

export function deriveStatus(input: { evidenceCount: number; enabled: boolean; learningPaused: boolean; lastLearnedAt: Date | null }, now: Date = new Date()): DigitalSelfStatus {
  if (!input.enabled || input.learningPaused) return DigitalSelfStatus.PAUSED;
  if (input.evidenceCount <= 0) return DigitalSelfStatus.INITIALIZING;
  if (input.evidenceCount >= READY_SAMPLES) return DigitalSelfStatus.READY;
  const idleDays = input.lastLearnedAt ? (now.getTime() - input.lastLearnedAt.getTime()) / 86_400_000 : Infinity;
  return idleDays > STALE_AFTER_DAYS ? DigitalSelfStatus.NEEDS_MORE_EXAMPLES : DigitalSelfStatus.LEARNING;
}

type Level = 'often' | 'sometimes' | 'rarely';

export interface StyleSummary {
  /** True when learned traits are reportable (enough of the agent's own replies). Overrides apply regardless. */
  hasLearnedTraits: boolean;
  samples: number;
  /** How much of the profile comes from approved style corrections. */
  correctionSamples: number;
  replyLength?: 'short' | 'medium' | 'detailed';
  averageWords?: number;
  sentenceLength?: 'short' | 'medium' | 'long';
  emoji?: 'none' | 'occasional' | 'frequent';
  formality?: 'formal' | 'balanced' | 'casual';
  warmth?: 'enthusiastic' | 'moderate' | 'reserved';
  followUps?: Level;
  empathy?: Level;
  acknowledges?: Level;
  contractions?: 'often' | 'rarely';
  codeSwitching?: 'often' | 'rarely';
  opening?: string;
  closing?: string;
  languages: string[];
  overridden: Array<keyof ProfileOverrides>;
}

const topKey = (map: Record<string, number>, minCount: number): string | undefined => {
  const [key, n] = Object.entries(map).sort((a, b) => b[1] - a[1])[0] ?? [];
  return key && (n ?? 0) >= minCount ? key : undefined;
};
const level = (rate: number, often: number, rarely: number): Level => (rate > often ? 'often' : rate < rarely ? 'rarely' : 'sometimes');

/** Turns accumulators into readable traits. A trait is reported only with MIN_ATTRIBUTE_SAMPLES of the agent's OWN replies behind it
 * (approved corrections refine a profile but never stand in for evidence). Business overrides always win over learned values. */
export function summarizeProfile(profile: DigitalSelfProfile): StyleSummary {
  const s = profile.samples;
  const own = s - profile.correctionSamples;
  const learned = own >= MIN_ATTRIBUTE_SAMPLES;
  const out: StyleSummary = { hasLearnedTraits: learned, samples: Math.round(own), correctionSamples: Math.round(profile.correctionSamples), languages: [], overridden: [] };

  if (learned) {
    const avg = profile.words / s;
    out.averageWords = Math.round(avg);
    out.replyLength = avg <= 15 ? 'short' : avg <= 45 ? 'medium' : 'detailed';
    const perSentence = profile.sentences > 0 ? profile.words / profile.sentences : 0;
    out.sentenceLength = perSentence <= 8 ? 'short' : perSentence <= 16 ? 'medium' : 'long';
    const emojiRate = profile.emojis / s;
    out.emoji = emojiRate < 0.05 ? 'none' : emojiRate < 0.3 ? 'occasional' : 'frequent';
    const markers = profile.formal + profile.casual;
    const formalScore = markers >= 5 ? (profile.formal - profile.casual) / markers : 0;
    // Mostly-lowercase openings are a casual-register signal even when no casual word appears.
    const lowerBias = profile.lowercaseStarts / s > 0.5 ? -0.4 : 0;
    const register = formalScore + lowerBias;
    out.formality = register > 0.3 ? 'formal' : register < -0.3 ? 'casual' : 'balanced';
    const exclaimRate = profile.exclaims / s;
    out.warmth = exclaimRate > 0.3 ? 'enthusiastic' : exclaimRate < 0.1 ? 'reserved' : 'moderate';
    out.followUps = level(profile.endQuestions / s, 0.3, 0.08);
    out.empathy = level(profile.empathy / s, 0.2, 0.05);
    out.acknowledges = level(profile.acknowledgements / s, 0.3, 0.08);
    out.contractions = profile.contractions / s > 0.3 ? 'often' : 'rarely';
    out.codeSwitching = profile.codeSwitches / s > 0.15 && profile.codeSwitches >= 5 ? 'often' : 'rarely';
    out.opening = topKey(profile.greetings, 5);
    out.closing = topKey(profile.closings, 5);
    out.languages = Object.entries(profile.languages).filter(([, n]) => n >= 5 && n / s >= 0.1).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }

  for (const key of Object.keys(profile.overrides) as Array<keyof ProfileOverrides>) {
    const value = profile.overrides[key];
    if (!value) continue;
    (out as unknown as Record<string, unknown>)[key === 'length' ? 'replyLength' : key] = value;
    out.overridden.push(key);
  }
  return out;
}

const LENGTH_TEXT = { short: 'short, to the point (usually a sentence or two)', medium: 'a few sentences', detailed: 'thorough, explaining things fully' } as const;
const SENTENCE_TEXT = { short: 'short, simple sentences', medium: 'sentences of moderate length', long: 'longer, more developed sentences' } as const;
const OPENING_TEXT: Record<string, string> = { time_of_day: 'a time-of-day greeting', dear: '"Dear ..."', welcome: 'a welcome', hello: '"Hello"', hi_hey: '"Hi" or "Hey"' };
const CLOSING_TEXT: Record<string, string> = { thanks: 'a thank-you', offer_help: 'an offer of further help', well_wishes: 'warm well-wishes' };
const LANGUAGE_TEXT: Record<string, string> = { pidgin: 'Pidgin', twi: 'Twi', ghanaian_english: 'Ghanaian English expressions', english: 'English' };

/** The compact prompt block. Empty when nothing has been learned and nothing is overridden, so the AI behaves exactly as it does
 * today instead of pretending to know the agent. Tone only: the block says so, and it never carries names, quotes or facts.
 * Lines are dropped whole, least important last, if the budget would otherwise cut one in half. */
export function formatStyleBlock(summary: StyleSummary): string {
  const lines: string[] = [];
  if (summary.replyLength) lines.push(`- Length: ${LENGTH_TEXT[summary.replyLength]}.`);
  if (summary.formality) lines.push(`- Register: ${summary.formality}.`);
  if (summary.warmth) lines.push(`- Energy: ${summary.warmth}.`);
  if (summary.emoji) lines.push(`- Emoji: ${summary.emoji}.`);
  if (summary.sentenceLength) lines.push(`- Writes ${SENTENCE_TEXT[summary.sentenceLength]}.`);
  if (summary.followUps === 'often') lines.push('- Often ends with a follow-up question.');
  if (summary.followUps === 'rarely') lines.push('- Rarely ends with a question.');
  if (summary.acknowledges === 'often') lines.push('- Often starts by acknowledging the request ("Sure", "Of course").');
  if (summary.empathy === 'often') lines.push('- Readily acknowledges the customer\'s situation or frustration before solving it.');
  if (summary.contractions === 'often') lines.push('- Uses contractions.');
  if (summary.opening) lines.push(`- Tends to open with ${OPENING_TEXT[summary.opening] ?? summary.opening} (not on every reply).`);
  if (summary.closing) lines.push(`- Tends to close with ${CLOSING_TEXT[summary.closing] ?? summary.closing} when it fits.`);
  const langs = summary.languages.map((l) => LANGUAGE_TEXT[l] ?? l).filter(Boolean);
  if (langs.length > 0) lines.push(`- Natural language: ${langs.join(', ')}; mirror the customer's language.`);
  if (summary.codeSwitching === 'often') lines.push('- Mixes English with local expressions when the customer does.');
  if (lines.length === 0) return '';
  const head = '\n\nCOMMUNICATION STYLE (how to sound only; this never changes facts, prices, stock, policies or what you may promise):\n';
  const kept: string[] = [];
  for (const line of lines) {
    if ((head + [...kept, line].join('\n')).length > MAX_STYLE_BLOCK_CHARS) break;
    kept.push(line);
  }
  return head + kept.join('\n');
}
