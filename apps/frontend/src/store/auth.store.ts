'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { UserRole } from '@whatsapp-platform/shared-types';
import { normalizeUserRole } from '@/lib/workspace-role';

/** Repairs a session user whose role is not one of the four coarse roles (see normalizeUserRole). */
function sanitizeUser<T extends { role: UserRole | string; workspaceRole?: string } | null>(user: T): T {
  if (!user) return user;
  const role = normalizeUserRole(user.role);
  const workspaceRole = user.workspaceRole ?? (role === user.role ? undefined : String(user.role));
  return { ...user, role, ...(workspaceRole ? { workspaceRole } : {}) };
}

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  /** The role held in the current workspace (OWNER, ADMIN, MANAGER, AGENT, ANALYST, VIEWER). */
  workspaceRole?: string;
  tenantId: string;
  avatarUrl?: string | null;
}

interface AuthTenant {
  id: string;
  name: string;
  onboardingCompleted?: boolean;
  plan?: string;
  logoUrl?: string;
}

export interface WorkspaceEntry {
  id: string;
  name: string;
  role: string;
}

interface AuthState {
  user: AuthUser | null;
  tenant: AuthTenant | null;
  workspaces: WorkspaceEntry[];
  // Access token lives in memory only — NOT persisted to localStorage.
  // Refresh token lives in an HttpOnly cookie — never touches JS.
  accessToken: string | null;
  isAuthenticated: boolean;
  _hasHydrated: boolean;

  setAuth: (user: AuthUser, tenant: AuthTenant, accessToken: string) => void;
  setAccessToken: (token: string) => void;
  setWorkspaces: (workspaces: WorkspaceEntry[]) => void;
  switchTenant: (tenant: AuthTenant, accessToken: string) => void;
  updateUser: (patch: Partial<AuthUser>) => void;
  clearAuth: () => void;
  setHasHydrated: (v: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      tenant: null,
      workspaces: [],
      accessToken: null,
      isAuthenticated: false,
      _hasHydrated: false,

      setAuth: (user, tenant, accessToken) => {
        if (typeof window !== 'undefined') {
          localStorage.setItem('access_token', accessToken);
        }
        set({ user: sanitizeUser(user), tenant, accessToken, isAuthenticated: true });
      },

      setAccessToken: (token) => {
        if (typeof window !== 'undefined') {
          localStorage.setItem('access_token', token);
        }
        set({ accessToken: token });
      },

      setWorkspaces: (workspaces) => set({ workspaces }),

      switchTenant: (tenant, accessToken) => {
        if (typeof window !== 'undefined') {
          localStorage.setItem('access_token', accessToken);
        }
        set({ tenant, accessToken });
      },

      updateUser: (patch) => set((state) => ({
        user: state.user ? sanitizeUser({ ...state.user, ...patch }) : state.user,
      })),

      clearAuth: () => {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('access_token');
        }
        set({ user: null, tenant: null, workspaces: [], accessToken: null, isAuthenticated: false });
      },

      setHasHydrated: (v) => set({ _hasHydrated: v }),
    }),
    {
      name: 'auth-storage',
      // Persist user identity but NOT the access token (expired on refresh; restore via cookie)
      // Refresh token is never in JS — lives in HttpOnly cookie only
      partialize: (state) => ({
        user: state.user,
        tenant: state.tenant,
        workspaces: state.workspaces,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        // A role saved by an older build (e.g. a raw workspace role name) would crash role-gated screens.
        if (state?.user) state.updateUser({});
        state?.setHasHydrated(true);
      },
    },
  ),
);
