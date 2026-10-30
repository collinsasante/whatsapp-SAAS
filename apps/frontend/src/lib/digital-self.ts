/** Shapes and wording for the AI Digital Self UI. The API (apps/backend/src/digital-self) is the source of truth for every value. */

export interface DigitalSelfSummary {
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
  overridden: string[];
}

export interface DigitalSelf {
  id: string;
  userId: string;
  name: string;
  role: string;
  avatarUrl: string | null;
  assignable: boolean;
  status: 'INITIALIZING' | 'LEARNING' | 'READY' | 'NEEDS_MORE_EXAMPLES' | 'PAUSED';
  enabled: boolean;
  learningPaused: boolean;
  evidenceCount: number;
  lastLearnedAt: string | null;
  lastError: string | null;
  profileVersion: number;
  summary: DigitalSelfSummary;
}

export interface DigitalSelfList {
  featureEnabled: boolean;
  thresholds: { minAttributeSamples: number; readySamples: number };
  items: DigitalSelf[];
}

export interface ConversationDigitalSelf {
  source: 'assigned' | 'owner' | null;
  digitalSelf: DigitalSelf | null;
}

export const STATUS_LABEL: Record<DigitalSelf['status'], string> = {
  INITIALIZING: 'Not started',
  LEARNING: 'Learning',
  READY: 'Ready',
  NEEDS_MORE_EXAMPLES: 'Needs more replies',
  PAUSED: 'Paused',
};

export const STATUS_TONE: Record<DigitalSelf['status'], string> = {
  INITIALIZING: 'bg-gray-100 text-gray-600',
  LEARNING: 'bg-blue-50 text-blue-700',
  READY: 'bg-green-50 text-green-700',
  NEEDS_MORE_EXAMPLES: 'bg-amber-50 text-amber-700',
  PAUSED: 'bg-gray-100 text-gray-500',
};

const LENGTH = { short: 'Short and to the point', medium: 'A few sentences', detailed: 'Thorough' } as const;
const EMOJI = { none: 'No emoji', occasional: 'Occasional emoji', frequent: 'Frequent emoji' } as const;
const FORMALITY = { formal: 'Formal', balanced: 'Balanced', casual: 'Casual' } as const;
const WARMTH = { enthusiastic: 'Enthusiastic', moderate: 'Moderate energy', reserved: 'Reserved' } as const;
const FOLLOW_UPS = { often: 'Often asks follow-up questions', sometimes: 'Sometimes asks follow-up questions', rarely: 'Rarely asks follow-up questions' } as const;
const OPENING: Record<string, string> = { time_of_day: 'Opens with a time-of-day greeting', dear: 'Opens with "Dear"', welcome: 'Opens with a welcome', hello: 'Opens with "Hello"', hi_hey: 'Opens with "Hi" or "Hey"' };
const CLOSING: Record<string, string> = { thanks: 'Closes with a thank-you', offer_help: 'Closes with an offer of more help', well_wishes: 'Closes with well-wishes' };
const LANGUAGE: Record<string, string> = { pidgin: 'Pidgin', twi: 'Twi', ghanaian_english: 'Ghanaian English', english: 'English' };

/** Human-readable traits for a Digital Self. Empty until enough replies have been learned from (or the team set something). */
export function describeStyle(s: DigitalSelfSummary): string[] {
  const out: string[] = [];
  if (s.replyLength) out.push(LENGTH[s.replyLength]);
  if (s.formality) out.push(FORMALITY[s.formality]);
  if (s.warmth) out.push(WARMTH[s.warmth]);
  if (s.emoji) out.push(EMOJI[s.emoji]);
  if (s.followUps) out.push(FOLLOW_UPS[s.followUps]);
  if (s.opening) out.push(OPENING[s.opening] ?? s.opening);
  if (s.closing) out.push(CLOSING[s.closing] ?? s.closing);
  if (s.languages.length > 0) out.push(`Language: ${s.languages.map((l) => LANGUAGE[l] ?? l).join(', ')}`);
  return out;
}

export const OVERRIDE_FIELDS = [
  { key: 'length', label: 'Reply length', options: [['short', 'Short'], ['medium', 'Medium'], ['detailed', 'Thorough']] },
  { key: 'emoji', label: 'Emoji', options: [['none', 'None'], ['occasional', 'Occasional'], ['frequent', 'Frequent']] },
  { key: 'formality', label: 'Formality', options: [['formal', 'Formal'], ['balanced', 'Balanced'], ['casual', 'Casual']] },
  { key: 'warmth', label: 'Energy', options: [['enthusiastic', 'Enthusiastic'], ['moderate', 'Moderate'], ['reserved', 'Reserved']] },
] as const;
