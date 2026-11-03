import { currentDisclosureVersion } from './learning-disclosure';

export interface LearningSettingsFlags {
  learningEnabled: boolean;
  learningPaused: boolean;
  disclosureVersion: string | null;
}

/**
 * The single rule for "may AI learning run for this workspace right now": opted in, not paused, AND the disclosure the administrator
 * acknowledged is the current one. No settings row, or no acknowledgement, means no. Every gate (cost ledger, Digital Self learner,
 * settings view) uses this so they cannot drift apart.
 */
export function isLearningPermitted(settings: LearningSettingsFlags | null | undefined, currentVersion: string = currentDisclosureVersion()): boolean {
  return !!settings && settings.learningEnabled && !settings.learningPaused && settings.disclosureVersion === currentVersion;
}

/** Why learning is not permitted (most fundamental reason first), or null when it is. */
export function learningBlockReason(settings: LearningSettingsFlags | null | undefined, currentVersion: string = currentDisclosureVersion()): 'not_enabled' | 'disclosure_outdated' | 'paused' | null {
  if (!settings?.learningEnabled) return 'not_enabled';
  if (settings.disclosureVersion !== currentVersion) return 'disclosure_outdated';
  if (settings.learningPaused) return 'paused';
  return null;
}
