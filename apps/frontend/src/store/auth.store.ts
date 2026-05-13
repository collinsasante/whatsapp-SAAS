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

interface AuthState {
  user: AuthUser | null;
  tenant: AuthTenant | null;
  // Access token lives in memory only — NOT persisted to localStorage.
  // Refresh token lives in an HttpOnly cookie — never touches JS.
  accessToken: string | null;
  isAuthenticated: boolean;
  _hasHydrated: boolean;

  setAuth: (user: AuthUser, tenant: AuthTenant, accessToken: string) => void;
  setAccessToken: (token: string) => void;
  clearAuth: () => void;
  setHasHydrated: (v: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      tenant: null,
      accessToken: null,
      isAuthenticated: false,
      _hasHydrated: false,

      setAuth: (user, tenant, accessToken) => {
        if (typeof window !== 'undefined') {
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

      clearAuth: () => {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('access_token');
        }
        set({ user: null, tenant: null, accessToken: null, isAuthenticated: false });
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
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
