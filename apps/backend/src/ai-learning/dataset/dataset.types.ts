/**
 * Shape of the evaluation dataset exported from real conversations. Records never carry a tenant id, conversation id, phone number,
 * contact name or absolute timestamp: references are keyed pseudonyms, times are offsets, and text is redacted (see pii-redaction).
 */
export const DATASET_SCHEMA_VERSION = 1;

export type TurnRole = 'customer' | 'ai' | 'human_agent' | 'system';
export type DatasetSplit = 'dev' | 'heldout';
export type Stratum = 'customer_only' | 'ai_only' | 'human_only' | 'ai_then_human' | 'human_then_ai' | 'mixed';

export interface DatasetTurn {
  i: number;
  role: TurnRole;
  /** Redacted. */
  text: string;
  /** Seconds since the first turn of the conversation. */
  t: number;
}

export interface DatasetRecord {
  schemaVersion: typeof DATASET_SCHEMA_VERSION;
  /** Keyed pseudonym of (tenant, conversation): stable across re-exports with the same key, not reversible without it. */
  conversationRef: string;
  tenantRef: string;
  /** dev: may be used to generate candidates. heldout: only for the final comparison, never for generating candidates. */
  split: DatasetSplit;
  stratum: Stratum;
  /** YYYY-MM of the first message. */
  startedMonth: string;
  turns: DatasetTurn[];
  /**
   * Indexes of turns that a human agent wrote. Only these are candidates for "what the right answer looked like".
   * AI turns are NEVER listed here: they are the thing being judged, not ground truth.
   */
  humanAnswerTurns: number[];
  signals: {
    aiTurns: number;
    humanTurns: number;
    humanTakeover: boolean;
    evaluated: boolean;
    lowestScore: number | null;
    needsHumanReview: boolean;
    customerCorrection: boolean;
    failureCategories: string[];
  };
  provenance: { source: 'production'; exportId: string; redactionVersion: string; truncatedTurns: boolean };
}

export type ExclusionReason = 'simulated' | 'eval_contact' | 'no_customer_message' | 'too_short' | 'duplicate';
