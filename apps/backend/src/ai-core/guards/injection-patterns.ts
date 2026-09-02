/**
 * Canonical prompt-injection pattern list. This is the single source of truth
 * for the v2 pipeline (GuardStage) and the /ai-logs/test sandbox -- both used
 * to keep their own copy (ai-logs.controller.ts's was even a 7-of-10 partial
 * duplicate). The legacy AiResponderService keeps its own inline copy
 * unchanged, matching the strangler guarantee that the legacy file is never
 * touched by this migration.
 */
export const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(previous|all|prior)\s+instructions?/i,
  /act\s+as\s+(an?\s+)?(admin|administrator|root|superuser|system)/i,
  /reveal\s+(your|the)\s+(system\s+)?prompt/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /forget\s+(everything|all)\s+(you|your)/i,
  /bypass\s+(safety|security|filter)/i,
  /export\s+(all\s+)?(the\s+)?(data|database|customers?|records?)/i,
  /give\s+me\s+(all\s+)?(the\s+)?(customer|user|phone|email)/i,
  /jailbreak/i,
  /dan\s+mode/i,
];

export function detectInjection(message: string): boolean {
  return INJECTION_PATTERNS.some((p) => p.test(message));
}
