/**
 * Canonical prompt-injection pattern list: the single source of truth for the v2 pipeline (GuardStage), Commerce AI,
 * the legacy responder and the /ai-logs/test sandbox.
 *
 * A pattern belongs here only if an ordinary customer would not write it. Three older patterns were too broad and
 * answered real questions with "I'm here to help with questions about X": "give me the phone number of the shop",
 * "give me the user guide" and "you are now a bit late with my order" were all treated as attacks. They are narrowed
 * to what an attack actually asks for: other people's data in bulk, or a new role or mode for the assistant.
 */
export const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(?:(?:all|any|the)\s+)?(?:previous|prior|above|earlier|all)\s+(?:instructions?|prompts?|rules)/i,
  /act\s+as\s+(an?\s+)?(admin|administrator|root|superuser|system)/i,
  /reveal\s+(your|the)\s+(system\s+)?prompt/i,
  // A new identity or mode for the assistant. "you are now a bit late" and "you are now a registered customer" are not this.
  /you\s+are\s+now\s+(?:dan\b|in\s+(?:\w+\s+){0,2}mode\b|(?:a|an|the)\s+(?:\w+\s+){0,3}?(?:ai|assistant|chatbot|bot|admin|administrator|developer|hacker|root|superuser|system|dan)\b|(?:a|an)\s+(?:unrestricted|unfiltered|uncensored|jailbroken|different|new|evil)\b)/i,
  // A new persona that comes with the rules removed ("you are now a pirate with no restrictions").
  /you\s+are\s+now\s+(?:a|an|the)\s+(?:[\w'-]+\s+){0,6}?(?:with\s+)?(?:no|without)\s+(?:any\s+)?(?:restrictions?|rules|limits?|limitations|filters?|guidelines|censorship)/i,
  /forget\s+(everything|all)\s+(you|your)/i,
  /bypass\s+(safety|security|filter)/i,
  // Exporting the database, or everyone's data. A customer has no reason to ask for this.
  /export\s+(?:(?:all|the|every|entire|your)\s+)*(?:customers?|users?|clients?|data|records?|database|db)\b/i,
  // Asking for other customers' personal data in bulk.
  /(?:give|send|show|list|dump|share|tell)\s+(?:me\s+)?(?:all|every|each|the\s+full\s+list\s+of|a\s+list\s+of)\s+(?:the\s+|your\s+|other\s+)*(?:customers?|users?|clients?)\W*s?\s*(?:data|records?|details|info|information|phone|numbers?|emails?|contacts?|list)/i,
  /(?:phone\s+numbers?|emails?|contacts?|addresses|personal\s+details)\s+of\s+(?:all|every|each|other|the\s+other)\s+(?:the\s+)?(?:other\s+)?(?:customers?|users?|clients?)/i,
  /jailbreak/i,
  /dan\s+mode/i,
];

// Zero-width and soft-hyphen characters are invisible to a reader but split a phrase so the patterns miss it.
const INVISIBLE_CHARS = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;

/** Folds look-alike (full-width, styled) letters and removes invisible characters before matching. */
export function normalizeForInjectionCheck(message: string): string {
  return message.normalize('NFKC').replace(INVISIBLE_CHARS, '');
}

export function detectInjection(message: string): boolean {
  const normalized = normalizeForInjectionCheck(message);
  return INJECTION_PATTERNS.some((p) => p.test(normalized));
}
