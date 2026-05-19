'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AdminMe } from '@/lib/platform-admin-api';

interface AdminState {
  token: string | null;
  admin: AdminMe | null;
  _hydrated: boolean;
  setAuth: (token: string, admin: AdminMe) => void;
  clearAuth: () => void;
  setHydrated: () => void;
}

export const useAdminStore = create<AdminState>()(
  persist(
    (set) => ({
      token: null,
      admin: null,
      _hydrated: false,
      setAuth: (token, admin) => set({ token, admin }),
      clearAuth: () => {
        if (typeof window !== 'undefined') localStorage.removeItem('pa_token');
        set({ token: null, admin: null });
      },
      setHydrated: () => set({ _hydrated: true }),
    }),
    {
      name: 'pa_auth',
      onRehydrateStorage: () => (state) => {
        state?.setHydrated();
        // Sync token to localStorage key expected by adminHttp interceptor
        if (state?.token && typeof window !== 'undefined') {
          localStorage.setItem('pa_token', state.token);
        }
      },
    },
  ),
);
