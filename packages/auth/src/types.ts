import { UserRole } from '@whatsapp-platform/shared-types';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tenantId: string;
  avatarUrl?: string | null;
}

export interface AuthTenant {
  id: string;
  name: string;
  onboardingCompleted?: boolean;
  plan?: string;
  logoUrl?: string | null;
}

export interface WorkspaceEntry {
  id: string;
  name: string;
  role: string;
}

export interface AuthSession {
  user: AuthUser;
  tenant: AuthTenant;
  accessToken: string;
  workspaces: WorkspaceEntry[];
}
