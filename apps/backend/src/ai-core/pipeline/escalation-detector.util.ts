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

  // Informal and spoken-style requests, including Ghanaian English and Pidgin ("I wan talk to person",
  // "abeg make I talk to somebody"). Each names a person-type object, so "talk to you about my order" or
  // "call me Kwame" does not match.
  /\b(?:need|want|wan|wanna|would like|'d like)\s+(?:to\s+)?(?:talk|speak|chat)\w*\s+(?:to|with|wit)\s+(?:a\s+|an\s+|the\s+|your\s+)?(?:real\s+|live\s+|actual\s+)?(?:some\s*one|some\s*body|any\s*one|any\s*body|person|human|agent|manager|owner|boss|supervisor|representative|staff)\b/i,
  /\b(?:let|make|help|get)\s+(?:me|us|i)\s+(?:talk|speak|chat)\w*\s+(?:to|with|wit)\s+(?:a\s+|an\s+|the\s+|your\s+)?(?:real\s+|live\s+|actual\s+)?(?:some\s*one|some\s*body|person|human|agent|manager|owner|boss|supervisor|representative|staff)\b/i,
  /\b(?:get|give|send|connect|put|transfer|bring|pass)\s+(?:me|us)\s+(?:(?:through\s+|over\s+)?to\s+)?(?:a\s+|an\s+|the\s+|your\s+)?(?:real\s+|live\s+|actual\s+)?(?:person|human|agent|manager|owner|boss|supervisor|representative|some\s*one|some\s*body)\b/i,
  /\b(?:need|want)\s+(?:a|an)\s+(?:human|agent|(?:real|live|actual)\s+person)\b/i,
  /\b(?:can|could|will|would|should)?\s*(?:some\s*one|some\s*body|any\s*one|a\s+(?:person|human|agent))\s+(?:please\s+|pls\s+)?(?:call|phone|ring|contact|reach|whatsapp)\s+me\b/i,
  /(?:^|[.!?,]\s*)(?:please\s+|pls\s+|plz\s+|kindly\s+|abeg\s+)?(?:call|phone|ring)\s+me\s*(?:please|pls|plz|now|back|asap|today|tomorrow|urgently|on\b|at\b|$|[.!?,])/i,
  /\bgive\s+me\s+a\s+(?:call|ring)\b/i,
  /\b(?:agent|operator|manager|supervisor|human)\s+(?:please|pls|plz)\b/i,
  /\b(?:please|pls|plz)\s+(?:an?\s+)?(?:agent|operator|manager|supervisor|human)\b/i,
  /\b(?:talk|speak)\w*\s+(?:to|with)\s+(?:the\s+|your\s+)?(?:owner|boss|manager|supervisor)\b/i,
  /\bwho(?:'s|\s+is)\s+in\s+charge\b/i,
  /\b(?:don'?t|do not)\s+(?:want|wanna|like)\s+(?:to\s+)?(?:talk|speak|chat|deal)\w*\s+(?:to|with)\s+(?:a\s+|an\s+)?(?:machine|automated|auto\s*reply)/i,
  /\b(?:stop|enough of)\s+(?:this\s+)?(?:bot|robot|chatbot|automated)\b/i,
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
