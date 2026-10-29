import { isUnsupportedFollowUpPromise } from '../pipeline/follow-up-promise.util';

/**
 * Deterministic checks for the wording problems D11 targets, so they can be asserted on controlled fixtures and, later, run over
 * replies collected from a live evaluation. This finds specific, mechanical problems. It does NOT judge whether a reply is
 * natural or helpful; that needs a human or a live model review.
 */
export type WordingIssue = 'filler_opening' | 'name_in_consecutive_replies' | 'repeated_greeting' | 'repeated_apology' | 'unsupported_follow_up_promise';

export interface WordingContext {
  customerName?: string;
  /** Earlier replies the assistant already sent in this conversation, oldest first. */
  previousAssistantReplies?: string[];
  toolTrace?: unknown;
}

const FILLER_OPENING = /^\s*(?:that'?s\s+a\s+(?:great|good)\s+question|(?:what\s+a\s+)?great\s+question|thanks?(?:\s+you)?\s+for\s+(?:reaching\s+out|your\s+message|contacting\s+us)|sure\s+thing|absolutely|certainly)\b/i;
const GREETING = /^\s*(?:hi|hello|hey|good\s+(?:morning|afternoon|evening))\b/i;
const APOLOGY = /\b(?:sorry|apologi[sz]e|apologies)\b/i;

const mentions = (text: string, name: string) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);

export function reviewReplyWording(reply: string, ctx: WordingContext = {}): WordingIssue[] {
  const issues: WordingIssue[] = [];
  const previous = ctx.previousAssistantReplies ?? [];
  const last = previous[previous.length - 1];

  if (FILLER_OPENING.test(reply)) issues.push('filler_opening');
  if (ctx.customerName && last && mentions(reply, ctx.customerName) && mentions(last, ctx.customerName)) issues.push('name_in_consecutive_replies');
  if (GREETING.test(reply) && previous.some((p) => GREETING.test(p))) issues.push('repeated_greeting');
  if (APOLOGY.test(reply) && last && APOLOGY.test(last)) issues.push('repeated_apology');
  if (isUnsupportedFollowUpPromise(reply, ctx.toolTrace)) issues.push('unsupported_follow_up_promise');
  return issues;
}
