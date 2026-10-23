import type { AuditLogRow } from '@/lib/admin-api';

const ACTIONS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in attempt',
  'auth.password_reset': 'Reset their password',
  'admin.invite': 'Invited an admin',
  'admin.role_change': 'Changed an admin role',
  'workspace.update': 'Edited a tenant',
  'workspace.suspend': 'Suspended a tenant',
  'workspace.activate': 'Reactivated a tenant',
  'workspace.force_plan': 'Assigned a plan without payment',
  'workspace.grant_credits': 'Granted AI credits',
  'workspace.set_commerce_config': 'Changed commerce settings for a tenant',
  'user.suspend': 'Suspended a user',
  'user.restore': 'Restored a user',
  'plan.create': 'Created a plan',
  'plan.update': 'Edited a plan',
  'ai_pricing.create': 'Added AI pricing',
  'ai_pricing.update': 'Edited AI pricing',
  'ai_credit_package.create': 'Created a credit package',
  'ai_credit_package.update': 'Edited a credit package',
  'feature_flag.create': 'Created a feature flag',
  'feature_flag.update': 'Edited a feature flag',
  'feature_flag.rollout_change': 'Changed a flag rollout',
  'settings.set_default_commerce_fee': 'Changed the default commerce fee',
  'error_log.status_change': 'Changed an error status',
  'webhook_event.reprocess': 'Reprocessed a webhook',
};

/** Actions that are worth a second look: they change what a customer can do, pay or see. */
export const SENSITIVE_ACTIONS = new Set([
  'workspace.suspend', 'workspace.force_plan', 'workspace.grant_credits', 'user.suspend', 'admin.role_change',
  'admin.invite', 'auth.login_failed', 'settings.set_default_commerce_fee', 'workspace.set_commerce_config',
]);

export function auditLabel(action: string): string {
  return ACTIONS[action] ?? action;
}

export const AUDIT_ACTION_OPTIONS = Object.entries(ACTIONS).map(([value, label]) => ({ value, label }));

/** Where the thing an action was done to can be opened, when there is a page for it. */
export function auditTargetHref(row: Pick<AuditLogRow, 'resourceType' | 'resourceId'>): string | null {
  if (!row.resourceId) return null;
  switch (row.resourceType) {
    case 'Tenant': return `/platform-admin/workspaces/${row.resourceId}`;
    case 'User': return `/platform-admin/users/${row.resourceId}`;
    case 'WebhookEvent': return '/platform-admin/webhooks';
    case 'ErrorLog': return '/platform-admin/errors';
    case 'FeatureFlag': return '/platform-admin/feature-flags';
    case 'Plan': return '/platform-admin/plans';
    case 'PlatformAdmin': return '/platform-admin/admins';
    default: return null;
  }
}

/** The reason an admin gave for an action, when one was recorded. */
export function auditReason(metadata: unknown): string | null {
  const reason = (metadata as { reason?: unknown } | null)?.reason;
  return typeof reason === 'string' && reason.trim() ? reason : null;
}

/** Why a sign-in failed, as recorded. */
export function auditFailureReason(metadata: unknown): string | null {
  const reason = (metadata as { reason?: unknown } | null)?.reason;
  switch (reason) {
    case 'wrong_password': return 'Wrong password';
    case 'unknown_account': return 'No admin account with that email';
    case 'account_disabled': return 'Account disabled';
    default: return null;
  }
}
