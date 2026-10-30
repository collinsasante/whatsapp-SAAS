import { MAX_ANALYSED_CHARS } from './digital-self.constants';

/** What the learning engine reads from one agent message. Derived numbers and tags only: the text itself is never kept. */
export interface MessageFeatures {
  words: number;
  hasQuestion: boolean;
  hasExclaim: boolean;
  hasEmoji: boolean;
  hasContraction: boolean;
  formalMarkers: number;
  casualMarkers: number;
  greeting: string | null;
  closing: string | null;
  languages: string[];
}

export interface CandidateMessage {
  tenantId: string;
  direction: string;
  type: string;
  senderId: string | null;
  senderIsAiAgent: boolean | null;
  templateId: string | null;
  content: string | null;
  metadata: unknown;
}

/**
 * Verified against MessagesService: an AI reply is stored with senderId = the synthetic isAiAgent Verz user (or null if that user
 * could not be created); a human reply from the inbox carries the signed-in agent's id. Everything else that is not the agent's own
 * typing is excluded: templates, auto-replies, simulated runs, and messages typed on the phone app (source 'external'), whose
 * author cannot be attributed to a signed-in agent.
 */
export function isEligibleHumanMessage(msg: CandidateMessage, tenantId: string, agentUserId: string): boolean {
  if (msg.tenantId !== tenantId) return false;
  if (msg.direction !== 'OUTBOUND' || msg.type !== 'TEXT') return false;
  if (msg.senderId !== agentUserId || msg.senderIsAiAgent !== false) return false;
  if (msg.templateId) return false;
  const meta = msg.metadata && typeof msg.metadata === 'object' ? (msg.metadata as Record<string, unknown>) : {};
  if (meta['isAutoReply'] || meta['simulated'] || meta['source'] === 'external' || meta['commerce']) return false;
  const text = (msg.content ?? '').trim();
  return text.length > 0 && text.length <= MAX_ANALYSED_CHARS;
}

const GREETINGS: Array<[string, RegExp]> = [
  ['time_of_day', /^(good\s+(morning|afternoon|evening))\b/],
  ['dear', /^dear\b/],
  ['welcome', /^(welcome|akwaaba)\b/],
  ['hello', /^hello\b/],
  ['hi_hey', /^(hi|hey)\b/],
];
const CLOSINGS: Array<[string, RegExp]> = [
  ['thanks', /\b(thank you|thanks|medaase)\b[^.?!]*[.!]*\s*(?:\p{Extended_Pictographic}|\s)*$/u],
  ['offer_help', /\b(let me know|feel free|anything else|reach out)\b[^?]*[.!?]*\s*(?:\p{Extended_Pictographic}|\s)*$/u],
  ['well_wishes', /\b(have a (great|nice|good|lovely|blessed)|god bless|take care|enjoy)\b[^?]*[.!]*\s*(?:\p{Extended_Pictographic}|\s)*$/u],
];

const FORMAL = /\b(kindly|please|sir|madam|regards|assist|inform|regret|apologi[sz]e|appreciate|would you)\b/gi;
const CASUAL = /\b(hey|yeah|yep|yup|okay|ok|cool|sure|no worries|lol|wow|abeg|chale|charley)\b/gi;
const CONTRACTION = /\b[a-z]+['’](s|t|re|ll|ve|d|m)\b/i;

/** Lexical markers only -- a language tag means "this lexicon appeared", not a claim about fluency. */
const LANGUAGE_MARKERS: Array<[string, RegExp]> = [
  ['pidgin', /\b(abeg|wahala|wetin|dey|oga|sef|na)\b/i],
  ['twi', /(medaase|akwaaba|mepaakyew|ete sen|[ɛɔ])/i],
  ['ghanaian_english', /\b(chale|charley|paa|small small|sharp sharp)\b/i],
];

export function extractFeatures(rawText: string): MessageFeatures | null {
  const text = rawText.trim();
  if (!text) return null;
  const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  if (words === 0) return null;
  const lower = text.toLowerCase();

  const languages = LANGUAGE_MARKERS.filter(([, re]) => re.test(text)).map(([tag]) => tag);
  if (languages.length === 0 && words >= 3) languages.push('english');

  return {
    words,
    hasQuestion: text.includes('?'),
    hasExclaim: text.includes('!'),
    hasEmoji: /\p{Extended_Pictographic}/u.test(text),
    hasContraction: CONTRACTION.test(text),
    formalMarkers: (lower.match(FORMAL) ?? []).length,
    casualMarkers: (lower.match(CASUAL) ?? []).length,
    greeting: GREETINGS.find(([, re]) => re.test(lower))?.[0] ?? null,
    closing: CLOSINGS.find(([, re]) => re.test(lower))?.[0] ?? null,
    languages,
  };
}
