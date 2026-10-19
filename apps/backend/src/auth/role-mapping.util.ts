import { UserRole } from '@whatsapp-platform/shared-types';

/**
 * Two role vocabularies exist: the workspace membership role (OWNER, ADMIN, MANAGER, AGENT, ANALYST,
 * VIEWER; the source of truth) and the coarser legacy User.role enum that authorization guards use.
 * Keep the translations here, in one place.
 */
export type WorkspaceRoleName = 'OWNER' | 'ADMIN' | 'MANAGER' | 'AGENT' | 'ANALYST' | 'VIEWER';
export const WORKSPACE_ROLE_NAMES: readonly WorkspaceRoleName[] = ['OWNER', 'ADMIN', 'MANAGER', 'AGENT', 'ANALYST', 'VIEWER'];

// Higher number = more privileged.
export const WORKSPACE_ROLE_RANK: Record<WorkspaceRoleName, number> = {
  OWNER: 5, ADMIN: 4, MANAGER: 3, AGENT: 2, ANALYST: 1, VIEWER: 1,
};

/** Best-effort workspace role for an account that has no membership row yet (legacy column only). */
export function legacyToWorkspaceRole(role: string): WorkspaceRoleName {
  switch (role) {
    case UserRole.SUPER_ADMIN: return 'OWNER';
    case UserRole.ADMIN: return 'ADMIN';
    case UserRole.VIEWER: return 'VIEWER';
    default: return 'AGENT';
  }
}

/**
 * What to store in the legacy User.role column for someone holding this workspace role. It is only a
 * fallback (membership wins), and it must never be SUPER_ADMIN: that value is reserved for platform staff.
 */
export function workspaceRoleToLegacyUserRole(role: string): UserRole {
  switch (role) {
    case 'OWNER':
    case 'ADMIN':
    case 'MANAGER': return UserRole.ADMIN;
    case 'ANALYST':
    case 'VIEWER': return UserRole.VIEWER;
    default: return UserRole.AGENT;
  }
}

/** Membership role for a legacy-role "create user" request. SUPER_ADMIN is not grantable here. */
export function userRoleToWorkspaceRole(role: string | undefined): WorkspaceRoleName {
  switch (role) {
    case UserRole.ADMIN: return 'ADMIN';
    case UserRole.VIEWER: return 'VIEWER';
    default: return 'AGENT';
  }
}

export function isWorkspaceRole(value: string): value is WorkspaceRoleName {
  return (WORKSPACE_ROLE_NAMES as readonly string[]).includes(value);
}
