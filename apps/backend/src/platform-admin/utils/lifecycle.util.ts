/**
 * Tenant lifecycle stages, in order. A tenant is "at" the furthest stage it
 * has reached -- stages are cumulative milestones, not mutually exclusive
 * states, so reaching a later one implies all earlier ones were also reached.
 */
export const LIFECYCLE_STAGES = [
  'signed_up',
  'whatsapp_connected',
  'template_approved',
  'first_engagement',
  'team_invited',
  'converted_paid',
  'active_last_7_days',
] as const;

export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export interface LifecycleInput {
  hasWhatsappNumber: boolean;
  hasApprovedTemplate: boolean;
  /** First broadcast sent OR first inbox conversation handled -- either counts as initial engagement. */
  hasFirstEngagement: boolean;
  /** More than one active user in the workspace. */
  hasInvitedTeammate: boolean;
  /** Subscription has ever reached ACTIVE (not just currently active -- a later churn doesn't erase this milestone). */
  everConvertedToPaid: boolean;
  /** Any user logged in within the last 7 days. */
  activeLast7Days: boolean;
}

export function deriveLifecycleStage(input: LifecycleInput): LifecycleStage {
  if (input.everConvertedToPaid && input.activeLast7Days) return 'active_last_7_days';
  if (input.everConvertedToPaid) return 'converted_paid';
  if (input.hasInvitedTeammate) return 'team_invited';
  if (input.hasFirstEngagement) return 'first_engagement';
  if (input.hasApprovedTemplate) return 'template_approved';
  if (input.hasWhatsappNumber) return 'whatsapp_connected';
  return 'signed_up';
}
