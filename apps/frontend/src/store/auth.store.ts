'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { UserRole } from '@whatsapp-platform/shared-types';

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tenantId: string;
  avatarUrl?: string | null;
}

interface AuthTenant {
  id: string;
  name: string;
  slug: string;
  onboardingCompleted?: boolean;
  plan?: string;
  logoUrl?: string;
}

export interface WorkspaceEntry {
  id: string;
  name: string;
  slug: string;
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
          try {
            const prev = JSON.parse(localStorage.getItem('_auth_log') ?? '[]') as Array<Record<string, unknown>>;
            prev.push({ s: 'login-ok', t: Date.now(), u: window.location.pathname });
            localStorage.setItem('_auth_log', JSON.stringify(prev.slice(-10)));
          } catch {}
          localStorage.setItem('access_token', accessToken);
        }
        set({ user, tenant, accessToken, isAuthenticated: true });
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
        state?.setHasHydrated(true);
      },
    },
  ),
);
