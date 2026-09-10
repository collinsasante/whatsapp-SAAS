/**
 * Second hardening pass, production-readiness audit: these two customer-facing
 * strings were hand-typed identically across 4 and 2 call sites respectively
 * (generation.stage.ts, commerce-ai.service.ts, messages.service.ts) -- real
 * duplication risk, since an edit to one copy silently drifting from the others
 * would produce an inconsistent voice for the same situation. Centralized here,
 * next to the other shared prompt/response text (shared-style-rules.ts,
 * shared-identity-block.ts).
 */

/** Shown when a generation call itself failed (provider error/timeout) --
 * written before the real handoff attempt happens, so it's deliberately
 * non-committal ("let me get someone to pick this up", not "I've connected you"). */
export const PROVIDER_FAILURE_FALLBACK_TEXT =
  "Give me a moment -- I'm having a little trouble on my end. Let me get someone to pick this up.";

/** Shown only once messages.service.ts has confirmed (via
 * ConversationsService.requestWithRetry) that the real handoff genuinely failed
 * after a retry -- replaces whatever optimistic text the generator produced, so
 * the customer is never told a human was reached when one wasn't. */
export const HANDOFF_FAILED_TEXT =
  "I'm having a little trouble connecting you to the right person right now. I've kept this conversation open so it doesn't get lost.";

/** Shown when a tool-calling loop hit its iteration ceiling without a final
 * answer (Commerce, and the v2 pipeline's tools branch) -- a real complexity
 * signal from the model's own behavior, distinct from a provider failure. */
export const MAX_ITERATIONS_FALLBACK_TEXT = 'Let me get a team member to help finish this up for you.';
