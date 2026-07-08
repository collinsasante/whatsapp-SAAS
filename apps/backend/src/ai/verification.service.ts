import { Injectable } from '@nestjs/common';
import { RetrievedChunk } from './retrieval.service';

export interface VerificationResult {
  passed: boolean;
  failReason: string | null;
  unverifiedDetail: boolean;
}

interface ExtractedPrice { raw: string; amount: number }

const PRICE_PATTERN = /(?:GHS|GH₵|₵|\$|USD)\s?(\d+(?:[.,]\d{1,2})?)/gi;
const PHONE_PATTERN = /(?:\+?\d[\d\s-]{8,14}\d)/g;
const URL_PATTERN = /https?:\/\/[^\s)]+/gi;
const DATE_PATTERN = /\b(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})\b|\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{2,4})?\b/gi;

// A minimal, best-effort signal, not a real language-ID model (none is
// available in this environment without adding a new NLP dependency). English
// function words are disproportionately common in real English text; their
// near-total absence in the customer's message combined with their heavy
// presence in the reply is a reasonable "possible language mismatch" flag,
// not a certainty -- see docs/verz-ai-audit.md for the documented limitation.
const ENGLISH_SIGNAL_WORDS = new Set(['the', 'is', 'are', 'and', 'you', 'your', 'for', 'with', 'have', 'this', 'that', 'we', 'our']);

const NEGATION_MARKERS = ['not ', "n't ", 'no ', 'never ', "isn't ", "aren't ", 'incorrect'];

// Each of these is its own factual claim (e.g. "official API" vs just "API"
// is a compliance/reliability claim, not a stylistic choice) that the model
// can add even when told not to invent facts -- prompt instructions alone
// aren't a hard guarantee, so this is checked in code too. Caught in eval
// testing: the model repeatedly added "official APIs" for a channels
// question when the retrieved source never said "official".
const UNSUPPORTED_QUALIFIER_WORDS = ['official', 'certified', 'guaranteed', 'unlimited', 'compliant', 'verified', 'approved'];

/** True if `text` mentions `needle` immediately after a negation marker --
 *  "no, it's GHS 313, not GHS 250" is the model correctly refuting a false
 *  premise, not asserting GHS 250 as fact. Without this, the exact "never
 *  confidently wrong" behavior we want gets penalized as an unverified price
 *  and force-escalated for no reason. */
function isNegatedMention(text: string, matchIndex: number): boolean {
  const precedingWindow = text.slice(Math.max(0, matchIndex - 15), matchIndex).toLowerCase();
  return NEGATION_MARKERS.some((m) => precedingWindow.includes(m));
}

function extractPrices(text: string, opts: { skipNegated?: boolean } = {}): ExtractedPrice[] {
  const out: ExtractedPrice[] = [];
  for (const m of text.matchAll(PRICE_PATTERN)) {
    if (opts.skipNegated && isNegatedMention(text, m.index ?? 0)) continue;
    const amount = parseFloat(m[1].replace(',', ''));
    if (!Number.isNaN(amount)) out.push({ raw: m[0], amount });
  }
  return out;
}

function normalizePhone(raw: string): string {
  return raw.replace(/[\s-]/g, '');
}

function normalizeUrl(raw: string): string {
  // Strip trailing sentence punctuation the URL regex swept up along with the
  // URL itself (e.g. "...register, not verzchat.com/signup" captures a
  // trailing comma) -- otherwise a correct URL fails comparison purely
  // because of the sentence around it.
  return raw.toLowerCase().replace(/[.,;:!?)]+$/, '').replace(/\/$/, '');
}

function englishSignalRatio(text: string): number {
  const words = text.toLowerCase().split(/\W+/).filter(Boolean);
  if (words.length === 0) return 0;
  const hits = words.filter((w) => ENGLISH_SIGNAL_WORDS.has(w)).length;
  return hits / words.length;
}

@Injectable()
export class VerificationService {
  /**
   * Gate run before any AI-generated reply is stored or sent. Checks:
   *  1. sources actually reference retrieved chunks (empty sources on an
   *     ANSWER is treated as ungrounded).
   *  2. every price/phone/URL/date mentioned in the reply appears (after
   *     normalization) in the cited chunks -- this is the specific guard
   *     against "KB says GHS 50, model says GHS 45".
   *  3. a best-effort reply/customer-message language-match signal.
   */
  verify(opts: {
    response: string;
    action: 'ANSWER' | 'ESCALATE' | 'CLARIFY';
    sources: string[];
    retrievedChunks: RetrievedChunk[];
    customerMessage: string;
  }): VerificationResult {
    if (opts.action !== 'ANSWER') {
      return { passed: true, failReason: null, unverifiedDetail: false };
    }

    if (opts.sources.length === 0) {
      return { passed: false, failReason: 'ANSWER with no cited sources', unverifiedDetail: false };
    }

    const retrievedIds = new Set(opts.retrievedChunks.map((c) => c.id));
    const invalidSource = opts.sources.find((id) => !retrievedIds.has(id));
    if (invalidSource) {
      return { passed: false, failReason: `cited source "${invalidSource}" was not actually retrieved`, unverifiedDetail: false };
    }

    const citedContent = opts.retrievedChunks
      .filter((c) => opts.sources.includes(c.id))
      .map((c) => c.content)
      .join('\n')
      .toLowerCase();

    // Prices: strict numeric match required -- this is the "never say GHS 45
    // when the source says GHS 50" guarantee. A price in the reply that
    // doesn't match ANY cited price is a hard failure, not just a flag.
    const replyPrices = extractPrices(opts.response, { skipNegated: true });
    const citedPrices = new Set(extractPrices(citedContent).map((p) => p.amount));
    const unverifiedPrice = replyPrices.find((p) => !citedPrices.has(p.amount));
    if (unverifiedPrice) {
      return { passed: false, failReason: `price "${unverifiedPrice.raw}" not found in cited sources`, unverifiedDetail: false };
    }

    // Phone numbers and URLs: normalize + substring check.
    const replyPhones = [...opts.response.matchAll(PHONE_PATTERN)].map((m) => normalizePhone(m[0]));
    const unverifiedPhone = replyPhones.find((p) => !citedContent.replace(/[\s-]/g, '').includes(p));

    const replyUrls = [...opts.response.matchAll(URL_PATTERN)].map((m) => normalizeUrl(m[0]));
    const unverifiedUrl = replyUrls.find((u) => !citedContent.includes(u));

    const lowerResponse = opts.response.toLowerCase();
    const unverifiedQualifier = UNSUPPORTED_QUALIFIER_WORDS.find(
      (w) => new RegExp(`\\b${w}\\b`).test(lowerResponse) && !new RegExp(`\\b${w}\\b`).test(citedContent),
    );

    // Dates: presence-based (formats vary too much for a clean numeric
    // comparison like prices) -- flagged as "unverified detail" rather than a
    // hard block, since a false positive here (e.g. today's date mentioned
    // conversationally) shouldn't silently block a good answer.
    const replyDates = [...opts.response.matchAll(DATE_PATTERN)];
    const hasUnverifiedDate = replyDates.length > 0 && !replyDates.some((m) => citedContent.includes(m[0].toLowerCase()));

    if (unverifiedPhone) {
      return { passed: false, failReason: `phone number "${unverifiedPhone}" not found in cited sources`, unverifiedDetail: false };
    }
    if (unverifiedUrl) {
      return { passed: false, failReason: `URL "${unverifiedUrl}" not found in cited sources`, unverifiedDetail: false };
    }
    if (unverifiedQualifier) {
      return { passed: false, failReason: `unsupported qualifier "${unverifiedQualifier}" not present in cited sources`, unverifiedDetail: false };
    }

    // Language check: best-effort signal only (see ENGLISH_SIGNAL_WORDS doc
    // comment) -- flags as an unverified detail rather than a hard block,
    // since false positives are likely on short customer messages.
    const customerEnglishRatio = englishSignalRatio(opts.customerMessage);
    const replyEnglishRatio = englishSignalRatio(opts.response);
    const languageMismatch = opts.customerMessage.split(/\s+/).length >= 4
      && customerEnglishRatio === 0
      && replyEnglishRatio > 0.15;

    return {
      passed: true,
      failReason: null,
      unverifiedDetail: hasUnverifiedDate || languageMismatch,
    };
  }
}
