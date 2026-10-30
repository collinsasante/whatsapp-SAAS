/**
 * A reply that promises "the team will follow up" is only true if something actually arranged it. Nothing in the reply text does
 * that, so this is detected deterministically (like the human-request detector) rather than trusted to the prompt: when it is not
 * backed by a real action this turn, the caller turns it into a real handoff instead of sending an empty promise.
 *
 * English phrasing only. A promise written in another language is not caught here and relies on the prompt rules.
 */
const FOLLOW_UP_VERBS = String.raw`(?:follow\s*-?\s*up|get\s+back|reach\s+out|be\s+in\s+touch|contact\s+you|call\s+you|message\s+you|respond\s+to\s+you)`;

const PROMISE_PATTERNS: readonly RegExp[] = [
  // "our team will follow up shortly", "a team member will get back to you", "my colleagues will reach out"
  new RegExp(String.raw`\b(?:our|the|my|a|one\s+of\s+our)\s+(?:\w+\s+){0,2}(?:team|colleagues?|staff|support)(?:\s+members?)?\s+(?:will|shall|is\s+going\s+to|are\s+going\s+to|'ll)\s+(?:\w+\s+)?${FOLLOW_UP_VERBS}`, 'i'),
  // "someone will get back to you", "someone from the team will call you"
  new RegExp(String.raw`\bsomeone(?:\s+from\s+(?:our|the)\s+team)?\s+(?:will|shall|is\s+going\s+to|'ll)\s+(?:\w+\s+)?${FOLLOW_UP_VERBS}`, 'i'),
  // "we'll get back to you", "I will follow up"
  new RegExp(String.raw`\b(?:we|i)(?:'ll|\s+will|\s+shall)\s+(?:\w+\s+)?${FOLLOW_UP_VERBS}`, 'i'),
  // The two wordings the old canned fallback produced.
  /\bteam (?:member )?will (?:follow up|assist)\b/i,
];

export function promisesFollowUp(text: string): boolean {
  return PROMISE_PATTERNS.some((p) => p.test(text));
}

interface TraceLike { name?: unknown; result?: unknown }

/**
 * True when a tool call this turn really did arrange a follow-up: an internal task was created, or an order was put into the
 * approval queue. An errored or malformed tool result never counts.
 */
export function followUpIsBacked(toolTrace: unknown): boolean {
  if (!Array.isArray(toolTrace)) return false;
  return (toolTrace as TraceLike[]).some((t) => {
    const r = t?.result as Record<string, unknown> | null | undefined;
    if (!r || typeof r !== 'object' || 'error' in r) return false;
    if (t.name === 'create_internal_task') return typeof r['taskId'] === 'string' && r['taskId'].length > 0;
    if (t.name === 'submit_order_for_payment') return r['status'] === 'AWAITING_APPROVAL';
    return false;
  });
}

/** What to do with a reply: nothing, or replace it with a real handoff because it promised a follow-up nothing arranged. */
export function isUnsupportedFollowUpPromise(response: string, toolTrace: unknown): boolean {
  return promisesFollowUp(response) && !followUpIsBacked(toolTrace);
}
