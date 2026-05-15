'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AdminState {
  admin: AdminUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  _hasHydrated: boolean;

  setAuth: (admin: AdminUser, accessToken: string) => void;
  clearAuth: () => void;
  setHasHydrated: (v: boolean) => void;
}

export const useAdminStore = create<AdminState>()(
  persist(
    (set) => ({
      admin: null,
      accessToken: null,
      isAuthenticated: false,
      _hasHydrated: false,

      setAuth: (admin, accessToken) => set({ admin, accessToken, isAuthenticated: true }),
      clearAuth: () => set({ admin: null, accessToken: null, isAuthenticated: false }),
      setHasHydrated: (v) => set({ _hasHydrated: v }),
    }),
    {
      name: 'pa-admin-storage',
      partialize: (state) => ({
        admin: state.admin,
        accessToken: state.accessToken,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
