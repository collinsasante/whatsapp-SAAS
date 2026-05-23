import { UserRole } from '@whatsapp-platform/shared-types';

const AGENT_ROUTES = ['/inbox', '/contacts', '/calls', '/library', '/account'];

// Routes each role can access. '*' means all routes allowed.
const ALLOWED: Record<UserRole, string[] | '*'> = {
  [UserRole.SUPER_ADMIN]: '*',
  [UserRole.ADMIN]:       '*',
  [UserRole.AGENT]:       AGENT_ROUTES,
  [UserRole.VIEWER]:      AGENT_ROUTES,
};

export function canAccess(role: UserRole | undefined, pathname: string): boolean {
  if (!role) return false;
  const allowed = ALLOWED[role];
  if (allowed === '*') return true;
  return allowed.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'));
}

// Fine-grained feature flags
export function getPermissions(role: UserRole | undefined) {
  const isAdmin  = role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN;
  const isAgent  = role === UserRole.AGENT || role === UserRole.VIEWER;
  const canAssign = isAdmin;

  return {
    // Nav visibility
    showDashboard:   isAdmin,
    showCampaigns:   isAdmin,
    showTemplates:   isAdmin,
    showAutomation:  isAdmin,
    showChatbot:     isAdmin,
    showAI:          isAdmin,
    showAnalytics:   isAdmin,
    showSettings:    isAdmin,
    showChannels:    isAdmin,
    showManage:      isAdmin,
    showBilling:     isAdmin,
    // Always visible
    showInbox:    true,
    showContacts: true,
    showCalls:    true,
    showLibrary:  true,

    // Action-level
    canAssign,
    canDeleteCampaign: isAdmin,
    canManageTeam:     isAdmin,
    canViewAnalytics:  isAdmin,
    isAdmin,
    isAgent,
  };
}

export type Permissions = ReturnType<typeof getPermissions>;
