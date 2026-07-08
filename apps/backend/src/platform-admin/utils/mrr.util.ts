export type MrrMovementCategory = 'NEW' | 'EXPANSION' | 'CONTRACTION' | 'CHURNED' | 'RETAINED' | 'NONE';

/**
 * Classifies how a tenant's MRR moved between two consecutive daily snapshots.
 * `previousMrr` is yesterday's (or the last recorded) snapshot; `currentMrr` is today's.
 */
export function classifyMrrMovement(previousMrr: number, currentMrr: number): MrrMovementCategory {
  if (previousMrr <= 0 && currentMrr <= 0) return 'NONE';
  if (previousMrr <= 0 && currentMrr > 0) return 'NEW';
  if (previousMrr > 0 && currentMrr <= 0) return 'CHURNED';
  if (currentMrr > previousMrr) return 'EXPANSION';
  if (currentMrr < previousMrr) return 'CONTRACTION';
  return 'RETAINED';
}
