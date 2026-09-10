/**
 * Explicit "let me talk to a human" phrasing. Deterministic and testable,
 * matching the same style as the injection-pattern detector -- no extra LLM
 * call needed to decide something this safety-relevant.
 */
const HUMAN_REQUEST_PATTERNS: readonly RegExp[] = [
  /speak (to|with) (a |an )?(human|person|agent|someone|representative|manager)/i,
  /talk (to|with) (a |an )?(human|person|agent|someone|representative|manager)/i,
  /(connect|transfer) me (with|to) (a |an )?(human|person|agent|someone|representative|manager|support)/i,
  /(real|actual|live) (person|human|agent)/i,
  /human (agent|support|help|representative)/i,
  /customer (service|support) (rep|representative|agent)/i,
  /is there a (human|person|agent|real (person|human))/i,
  /can (i|you) (speak|talk) to (someone|somebody)/i,
  /i (want|need) to speak to someone/i,
  // Rejecting the AI itself, not asking a question it can't answer -- still a
  // real "get me a human" signal even without naming a role.
  /(hate|don'?t (want|like)( to)?) (chat(ting)?|talk(ing)?|deal(ing)?) (to|with) (an? )?(ai|bot|chatbot|robot)/i,
  /stop (being|acting like) a (bot|robot|chatbot)/i,
];

/** Very low confidence means the model itself is signaling a knowledge gap it
 * can't fill -- a secondary, less certain trigger alongside explicit requests. */
const LOW_CONFIDENCE_ESCALATION_THRESHOLD = 20;

export function detectHumanRequest(message: string): boolean {
  return HUMAN_REQUEST_PATTERNS.some((p) => p.test(message));
}

export function shouldEscalateOnConfidence(confidence: number | null): boolean {
  return confidence !== null && confidence <= LOW_CONFIDENCE_ESCALATION_THRESHOLD;
}
