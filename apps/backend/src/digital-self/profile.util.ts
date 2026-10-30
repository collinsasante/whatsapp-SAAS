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

/** Incremental accumulators, not text. `samples` and the counters are windowed (see mergeFeatures); `overrides` are business corrections. */
export interface DigitalSelfProfile {
  v: number;
  samples: number;
  words: number;
  questions: number;
  exclaims: number;
  emojis: number;
  contractions: number;
  formal: number;
  casual: number;
  greetings: Record<string, number>;
  closings: Record<string, number>;
  languages: Record<string, number>;
  overrides: ProfileOverrides;
}

export function emptyProfile(): DigitalSelfProfile {
  return { v: PROFILE_SCHEMA_VERSION, samples: 0, words: 0, questions: 0, exclaims: 0, emojis: 0, contractions: 0, formal: 0, casual: 0, greetings: {}, closings: {}, languages: {}, overrides: {} };
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
  return {
    v: PROFILE_SCHEMA_VERSION,
    samples: num(r['samples']), words: num(r['words']), questions: num(r['questions']), exclaims: num(r['exclaims']),
    emojis: num(r['emojis']), contractions: num(r['contractions']), formal: num(r['formal']), casual: num(r['casual']),
    greetings: counts(r['greetings']), closings: counts(r['closings']), languages: counts(r['languages']), overrides,
  };
}

const bump = (map: Record<string, number>, key: string | null) => {
  if (key) map[key] = (map[key] ?? 0) + 1;
};

/** Adds a batch of messages to the accumulators. Past PROFILE_WINDOW everything is scaled down proportionally, which is a cheap
 * exponential-forgetting: recent habits count more and a single odd message moves a mature profile by at most 1/WINDOW. */
export function mergeFeatures(profile: DigitalSelfProfile, batch: MessageFeatures[]): DigitalSelfProfile {
  const next: DigitalSelfProfile = { ...profile, greetings: { ...profile.greetings }, closings: { ...profile.closings }, languages: { ...profile.languages }, overrides: { ...profile.overrides } };
  for (const f of batch) {
    next.samples += 1;
    next.words += f.words;
    if (f.hasQuestion) next.questions += 1;
    if (f.hasExclaim) next.exclaims += 1;
    if (f.hasEmoji) next.emojis += 1;
    if (f.hasContraction) next.contractions += 1;
    next.formal += f.formalMarkers;
    next.casual += f.casualMarkers;
    bump(next.greetings, f.greeting);
    bump(next.closings, f.closing);
    for (const lang of f.languages) bump(next.languages, lang);
  }
  if (next.samples > PROFILE_WINDOW) {
    const k = PROFILE_WINDOW / next.samples;
    for (const key of ['samples', 'words', 'questions', 'exclaims', 'emojis', 'contractions', 'formal', 'casual'] as const) next[key] *= k;
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

export interface StyleSummary {
  /** True when learned traits are reportable (enough eligible messages). Overrides apply regardless. */
  hasLearnedTraits: boolean;
  samples: number;
  replyLength?: 'short' | 'medium' | 'detailed';
  averageWords?: number;
  emoji?: 'none' | 'occasional' | 'frequent';
  formality?: 'formal' | 'balanced' | 'casual';
  warmth?: 'enthusiastic' | 'moderate' | 'reserved';
  followUps?: 'often' | 'sometimes' | 'rarely';
  contractions?: 'often' | 'rarely';
  opening?: string;
  closing?: string;
  languages: string[];
  overridden: Array<keyof ProfileOverrides>;
}

const topKey = (map: Record<string, number>, minCount: number): string | undefined => {
  const [key, n] = Object.entries(map).sort((a, b) => b[1] - a[1])[0] ?? [];
  return key && (n ?? 0) >= minCount ? key : undefined;
};

/** Turns accumulators into readable traits. A trait is reported only with MIN_ATTRIBUTE_SAMPLES behind it -- below that the
 * summary is empty rather than a guess. Business overrides always win over learned values. */
export function summarizeProfile(profile: DigitalSelfProfile): StyleSummary {
  const s = profile.samples;
  const learned = s >= MIN_ATTRIBUTE_SAMPLES;
  const out: StyleSummary = { hasLearnedTraits: learned, samples: Math.round(s), languages: [], overridden: [] };

  if (learned) {
    const avg = profile.words / s;
    out.averageWords = Math.round(avg);
    out.replyLength = avg <= 15 ? 'short' : avg <= 45 ? 'medium' : 'detailed';
    const emojiRate = profile.emojis / s;
    out.emoji = emojiRate < 0.05 ? 'none' : emojiRate < 0.3 ? 'occasional' : 'frequent';
    const markers = profile.formal + profile.casual;
    const formalScore = markers >= 5 ? (profile.formal - profile.casual) / markers : 0;
    out.formality = formalScore > 0.3 ? 'formal' : formalScore < -0.3 ? 'casual' : 'balanced';
    const exclaimRate = profile.exclaims / s;
    out.warmth = exclaimRate > 0.3 ? 'enthusiastic' : exclaimRate < 0.1 ? 'reserved' : 'moderate';
    const questionRate = profile.questions / s;
    out.followUps = questionRate > 0.35 ? 'often' : questionRate < 0.1 ? 'rarely' : 'sometimes';
    out.contractions = profile.contractions / s > 0.3 ? 'often' : 'rarely';
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
const OPENING_TEXT: Record<string, string> = { time_of_day: 'a time-of-day greeting', dear: '"Dear ..."', welcome: 'a welcome', hello: '"Hello"', hi_hey: '"Hi" or "Hey"' };
const CLOSING_TEXT: Record<string, string> = { thanks: 'a thank-you', offer_help: 'an offer of further help', well_wishes: 'warm well-wishes' };
const LANGUAGE_TEXT: Record<string, string> = { pidgin: 'Pidgin', twi: 'Twi', ghanaian_english: 'Ghanaian English expressions', english: 'English' };

/** The compact prompt block. Empty when nothing has been learned and nothing is overridden, so the AI behaves exactly as it does
 * today instead of pretending to know the agent. Tone only: the block says so, and it never carries names, quotes or facts. */
export function formatStyleBlock(summary: StyleSummary): string {
  const lines: string[] = [];
  if (summary.replyLength) lines.push(`- Length: ${LENGTH_TEXT[summary.replyLength]}.`);
  if (summary.formality) lines.push(`- Register: ${summary.formality}.`);
  if (summary.warmth) lines.push(`- Energy: ${summary.warmth}.`);
  if (summary.emoji) lines.push(`- Emoji: ${summary.emoji === 'none' ? 'none' : summary.emoji}.`);
  if (summary.followUps === 'often') lines.push('- Often ends with a follow-up question.');
  if (summary.followUps === 'rarely') lines.push('- Rarely asks follow-up questions.');
  if (summary.contractions === 'often') lines.push('- Uses contractions.');
  if (summary.opening) lines.push(`- Tends to open with ${OPENING_TEXT[summary.opening] ?? summary.opening} (not on every reply).`);
  if (summary.closing) lines.push(`- Tends to close with ${CLOSING_TEXT[summary.closing] ?? summary.closing} when it fits.`);
  const langs = summary.languages.map((l) => LANGUAGE_TEXT[l] ?? l).filter(Boolean);
  if (langs.length > 0) lines.push(`- Natural language: ${langs.join(', ')}; mirror the customer's language.`);
  if (lines.length === 0) return '';
  const block = `\n\nCOMMUNICATION STYLE (how to sound only; this never changes facts, prices, stock, policies or what you may promise):\n${lines.join('\n')}`;
  return block.length <= MAX_STYLE_BLOCK_CHARS ? block : block.slice(0, MAX_STYLE_BLOCK_CHARS);
}
