import { UserRole } from '@whatsapp-platform/shared-types';

const ROLE_HIERARCHY: Record<UserRole, number> = {
  [UserRole.SUPER_ADMIN]: 4,
  [UserRole.ADMIN]: 3,
  [UserRole.AGENT]: 2,
  [UserRole.VIEWER]: 1,
};

export function hasRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[requiredRole] ?? 0);
}

export function isAdmin(role: UserRole): boolean {
  return hasRole(role, UserRole.ADMIN);
}

export function isSuperAdmin(role: UserRole): boolean {
  return role === UserRole.SUPER_ADMIN;
}

export function canManageAgents(role: UserRole): boolean {
  return isAdmin(role);
}

export function canViewAnalytics(role: UserRole): boolean {
  return hasRole(role, UserRole.VIEWER);
}

export function canSendMessages(role: UserRole): boolean {
  return hasRole(role, UserRole.AGENT);
}

/**
 * Mirrors apps/frontend/src/lib/permissions.ts's getPermissions() exactly --
 * same flag names, same isAdmin-gated set. Keep the two in sync; this is the
 * source shared clients (mobile) should use instead of re-deriving role
 * checks locally.
 */
export function getPermissions(role: UserRole | undefined) {
  const admin = role != null && isAdmin(role);
  const agent = role === UserRole.AGENT || role === UserRole.VIEWER;
  const canAssign = admin;

  return {
    showDashboard: admin,
    showCampaigns: admin,
    showTemplates: admin,
    showAutomation: admin,
    showChatbot: admin,
    showAI: admin,
    showAnalytics: true,
    showSettings: admin,
    showChannels: admin,
    showManage: admin,
    showBilling: admin,
    showCommerce: admin,
    showInbox: true,
    showContacts: true,
    showCalls: true,
    showLibrary: true,
    canAssign,
    canDeleteCampaign: admin,
    canManageTeam: admin,
    canViewAnalytics: true,
    isAdmin: admin,
    isAgent: agent,
  };
}

export type Permissions = ReturnType<typeof getPermissions>;
