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
