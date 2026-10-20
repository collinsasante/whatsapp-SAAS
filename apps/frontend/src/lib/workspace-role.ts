import { UserRole } from '@whatsapp-platform/shared-types';

/**
 * Workspace membership roles are the source of truth; UserRole is the coarser enum the route and nav
 * permissions use. Mirrors apps/backend/src/auth/role-mapping.util.ts and jwt.strategy.ts: keep them in step.
 */
export const WORKSPACE_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'AGENT', 'ANALYST', 'VIEWER'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

const RANK: Record<WorkspaceRole, number> = { OWNER: 5, ADMIN: 4, MANAGER: 3, AGENT: 2, ANALYST: 1, VIEWER: 1 };

export function isWorkspaceRole(value: string | null | undefined): value is WorkspaceRole {
  return !!value && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

const USER_ROLES: readonly string[] = Object.values(UserRole);

/**
 * Anything that reaches the `role` field must be one of the four coarse roles, because route and nav
 * permissions index a table by it. Workspace role names (MANAGER, OWNER...) are translated; an unknown
 * value gets the least-privileged working role rather than undefined (which crashed the layout).
 */
export function normalizeUserRole(role: string | null | undefined): UserRole {
  if (role && USER_ROLES.includes(role)) return role as UserRole;
  if (isWorkspaceRole(role)) return workspaceRoleToUserRole(role);
  return UserRole.AGENT;
}

export function workspaceRoleToUserRole(role: string | null | undefined): UserRole {
  switch (role) {
    case 'OWNER': return UserRole.SUPER_ADMIN;
    case 'ADMIN':
    case 'MANAGER': return UserRole.ADMIN;
    case 'ANALYST':
    case 'VIEWER': return UserRole.VIEWER;
    default: return UserRole.AGENT;
  }
}

/** Best guess for the workspace role of a session that only carries the coarse role. */
export function userRoleToWorkspaceRole(role: UserRole | string | undefined): WorkspaceRole {
  switch (role) {
    case UserRole.SUPER_ADMIN: return 'OWNER';
    case UserRole.ADMIN: return 'ADMIN';
    case UserRole.VIEWER: return 'VIEWER';
    default: return 'AGENT';
  }
}

export function workspaceRoleLabel(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

const DESCRIPTIONS: Record<WorkspaceRole, string> = {
  OWNER: 'Full control of this workspace, including billing, team and security settings.',
  ADMIN: 'Full access to this workspace including settings and billing.',
  MANAGER: 'Manages the team and conversations, with access to workspace settings.',
  AGENT: 'Can handle conversations in the inbox.',
  ANALYST: 'Read-only access to inbox, contacts and analytics.',
  VIEWER: 'Read-only access to inbox and contacts.',
};

export function workspaceRoleDescription(role: string): string {
  return isWorkspaceRole(role) ? DESCRIPTIONS[role] : '';
}

/** Roles someone may hand out: never above their own. The server enforces this too. */
export function assignableWorkspaceRoles(actorRole: string | null | undefined, alsoInclude?: string): WorkspaceRole[] {
  const actorRank = isWorkspaceRole(actorRole) ? RANK[actorRole] : 0;
  const allowed = WORKSPACE_ROLES.filter((r) => RANK[r] <= actorRank);
  if (isWorkspaceRole(alsoInclude) && !allowed.includes(alsoInclude)) allowed.unshift(alsoInclude);
  return allowed;
}
