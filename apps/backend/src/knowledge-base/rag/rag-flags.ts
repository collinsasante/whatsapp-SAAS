/**
 * Hybrid retrieval is opt-in per deployment: only the exact value "true" turns it on. Anything else (unset, "TRUE", "1", "yes") leaves
 * the pipeline on the existing keyword retrieval, so a typo can never switch it on by accident.
 */
export function isHybridRagEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env['RAG_HYBRID_ENABLED'] === 'true';
}
