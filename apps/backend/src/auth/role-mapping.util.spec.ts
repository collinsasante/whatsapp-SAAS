import { UserRole } from '@whatsapp-platform/shared-types';
import { workspaceRoleToUserRole } from './strategies/jwt.strategy';
import { isWorkspaceRole, legacyToWorkspaceRole, userRoleToWorkspaceRole, workspaceRoleToLegacyUserRole, WORKSPACE_ROLE_RANK } from './role-mapping.util';

describe('role mapping', () => {
  it('an Owner is never stored as SUPER_ADMIN in the legacy column (that value is for platform staff)', () => {
    for (const role of ['OWNER', 'ADMIN', 'MANAGER']) expect(workspaceRoleToLegacyUserRole(role)).toBe(UserRole.ADMIN);
    expect(workspaceRoleToLegacyUserRole('AGENT')).toBe(UserRole.AGENT);
    for (const role of ['ANALYST', 'VIEWER']) expect(workspaceRoleToLegacyUserRole(role)).toBe(UserRole.VIEWER);
  });

  it('a legacy-role create request keeps VIEWER and ADMIN instead of collapsing everything to AGENT', () => {
    expect(userRoleToWorkspaceRole(UserRole.ADMIN)).toBe('ADMIN');
    expect(userRoleToWorkspaceRole(UserRole.VIEWER)).toBe('VIEWER');
    expect(userRoleToWorkspaceRole(UserRole.AGENT)).toBe('AGENT');
    expect(userRoleToWorkspaceRole(undefined)).toBe('AGENT');
  });

  it('SUPER_ADMIN is not grantable through the legacy create path', () => {
    expect(userRoleToWorkspaceRole(UserRole.SUPER_ADMIN)).toBe('AGENT');
  });

  it('the legacy fallback never invents Owner privileges for plain roles', () => {
    expect(legacyToWorkspaceRole(UserRole.AGENT)).toBe('AGENT');
    expect(legacyToWorkspaceRole(UserRole.ADMIN)).toBe('ADMIN');
    expect(legacyToWorkspaceRole('anything-else')).toBe('AGENT');
  });

  it('the session role for each workspace role grants Owner top access and Agent none of it', () => {
    expect(workspaceRoleToUserRole('OWNER')).toBe(UserRole.SUPER_ADMIN);
    expect(workspaceRoleToUserRole('ADMIN')).toBe(UserRole.ADMIN);
    expect(workspaceRoleToUserRole('AGENT')).toBe(UserRole.AGENT);
    expect(workspaceRoleToUserRole('VIEWER')).toBe(UserRole.VIEWER);
    expect(workspaceRoleToUserRole('???')).toBe(UserRole.AGENT);
  });

  it('ranks Owner above everyone and recognises only real roles', () => {
    expect(WORKSPACE_ROLE_RANK.OWNER).toBeGreaterThan(WORKSPACE_ROLE_RANK.ADMIN);
    expect(isWorkspaceRole('OWNER')).toBe(true);
    expect(isWorkspaceRole('owner')).toBe(false);
    expect(isWorkspaceRole('SUPER_ADMIN')).toBe(false);
  });
});
