import { create } from 'zustand';
import type { AuthUser, AuthTenant, WorkspaceEntry } from '@whatsapp-platform/auth';
import { mobileTokenStorage } from '../lib/storage';

interface AuthState {
  user: AuthUser | null;
  tenant: AuthTenant | null;
  workspaces: WorkspaceEntry[];
  isAuthenticated: boolean;

  setAuth: (user: AuthUser, tenant: AuthTenant, accessToken: string) => void;
  setAccessToken: (token: string) => void;
  setWorkspaces: (workspaces: WorkspaceEntry[]) => void;
  switchTenant: (tenant: AuthTenant, accessToken: string) => void;
  updateUser: (patch: Partial<AuthUser>) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  tenant: null,
  workspaces: [],
  isAuthenticated: false,

  setAuth: (user, tenant, accessToken) => {
    mobileTokenStorage.setAccessToken(accessToken);
    set({ user, tenant, isAuthenticated: true });
  },

  setAccessToken: (token) => {
    mobileTokenStorage.setAccessToken(token);
  },

  setWorkspaces: (workspaces) => set({ workspaces }),

  switchTenant: (tenant, accessToken) => {
    mobileTokenStorage.setAccessToken(accessToken);
    set({ tenant });
  },

  updateUser: (patch) =>
    set((state) => ({
      user: state.user ? { ...state.user, ...patch } : state.user,
    })),

  clearAuth: () => {
    mobileTokenStorage.clearAccessToken();
    set({ user: null, tenant: null, workspaces: [], isAuthenticated: false });
  },
}));
