/** Fewest eligible messages before ANY learned attribute is reported or used. Below this the profile says "not enough evidence". */
export const MIN_ATTRIBUTE_SAMPLES = 10;
/** Eligible messages before the Digital Self is called READY. */
export const READY_SAMPLES = 30;
/** Older evidence is scaled down once more than this many messages are held, so recent habits outweigh old ones and no single message can swing a mature profile. */
export const PROFILE_WINDOW = 200;
/** A profile below READY that has learned nothing for this long needs more examples rather than still "learning". */
export const STALE_AFTER_DAYS = 30;
/** Longest message that is analysed. Longer text is almost certainly pasted material, not the agent's conversational style. */
export const MAX_ANALYSED_CHARS = 2000;
/** Upper bound on the style block added to a prompt. */
export const MAX_STYLE_BLOCK_CHARS = 1000;
/** Sentinel for the profile JSON shape, so a future shape (semantic learning) can be migrated rather than guessed. */
export const PROFILE_SCHEMA_VERSION = 2;

export const OVERRIDE_OPTIONS = {
  length: ['short', 'medium', 'detailed'],
  emoji: ['none', 'occasional', 'frequent'],
  formality: ['formal', 'balanced', 'casual'],
  warmth: ['enthusiastic', 'moderate', 'reserved'],
} as const;
