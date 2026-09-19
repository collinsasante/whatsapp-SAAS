import { UserRole } from '@whatsapp-platform/shared-types';

const AGENT_ROUTES = ['/inbox', '/contacts', '/calls', '/library', '/account', '/analytics'];

// Routes each role can access. '*' means all routes allowed.
const ALLOWED: Record<UserRole, string[] | '*'> = {
  [UserRole.SUPER_ADMIN]: '*',
  [UserRole.ADMIN]:       '*',
  [UserRole.AGENT]:       AGENT_ROUTES,
  [UserRole.VIEWER]:      AGENT_ROUTES,
};

// Internal AI/Commerce testing & evaluation tools -- shared by Sidebar,
// MobileDrawer, and canAccess() below so there's one list, not three. Baked
// in at build time like every other NEXT_PUBLIC_* var; unset (falsy) unless
// infra/docker-compose.staging.yml's frontend build arg sets it, so these
// stay unreachable in production regardless of role (SUPER_ADMIN/ADMIN's
// '*' route access in ALLOWED above would otherwise let a real customer's
// own admin reach them).
export const DEV_TOOL_ROUTES = ['/ai-test', '/ai/test-chat', '/commerce/chat', '/commerce/evaluation'];
export const SHOW_DEV_TOOLS = process.env.NEXT_PUBLIC_SHOW_DEV_TOOLS === 'true';

export function isDevToolRoute(pathname: string): boolean {
  return DEV_TOOL_ROUTES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'));
}

export function canAccess(role: UserRole | undefined, pathname: string): boolean {
  if (!role) return false;
  if (isDevToolRoute(pathname) && !SHOW_DEV_TOOLS) return false;
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
    showAnalytics:   true, // agents get a scoped (own-performance-only) view; the API enforces the actual scoping
    showSettings:    isAdmin,
    showChannels:    isAdmin,
    showManage:      isAdmin,
    showBilling:     isAdmin,
    showCommerce:    isAdmin,
    // Always visible
    showInbox:    true,
    showContacts: true,
    showCalls:    true,
    showLibrary:  true,

    // Action-level
    canAssign,
    canDeleteCampaign: isAdmin,
    canManageTeam:     isAdmin,
    canViewAnalytics:  true, // scoped per-role by the API, not the frontend
    isAdmin,
    isAgent,
  };
}

export type Permissions = ReturnType<typeof getPermissions>;
