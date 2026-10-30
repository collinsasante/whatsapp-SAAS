'use client';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { adminApi } from '@/lib/admin-api';

export type PlatformRole = 'SUPER_ADMIN' | 'SUPPORT' | 'VIEWER';

export interface AdminSession {
  id: string;
  name: string;
  email: string;
  role: PlatformRole;
  lastLoginAt: string | null;
}

export type EnvironmentName = 'Production' | 'Staging' | 'Local';

interface AdminContextValue {
  admin: AdminSession | null;
  /** loading until the session is checked; error if it could not be checked (the server may be down). */
  status: 'loading' | 'ready' | 'error';
  environment: EnvironmentName;
  /** VIEWER may read everything and change nothing. */
  canChange: boolean;
  /** Only SUPER_ADMIN may grant credits, override plans and manage admins. */
  isSuperAdmin: boolean;
}

const AdminContext = createContext<AdminContextValue>({ admin: null, status: 'loading', environment: 'Production', canChange: false, isSuperAdmin: false });

/** Which deployment this console is open on, from the address, so nobody mistakes staging for production. */
export function detectEnvironment(hostname: string): EnvironmentName {
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'Local';
  return /staging/i.test(hostname) ? 'Staging' : 'Production';
}

/**
 * The signed-in admin's role, used to hide or disable controls the server would refuse anyway. This is a courtesy to
 * the person using the console: the server checks the role on every request and is the only real protection.
 */
export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [admin, setAdmin] = useState<AdminSession | null>(null);
  const [environment, setEnvironment] = useState<EnvironmentName>('Production');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    setEnvironment(detectEnvironment(window.location.hostname));
    adminApi.me()
      .then((me) => { setAdmin({ ...me, role: me.role as PlatformRole }); setStatus('ready'); })
      .catch(() => { setAdmin(null); setStatus('error'); });
  }, []);

  const value = useMemo<AdminContextValue>(() => ({
    admin,
    status,
    environment,
    canChange: admin?.role === 'SUPER_ADMIN' || admin?.role === 'SUPPORT',
    isSuperAdmin: admin?.role === 'SUPER_ADMIN',
  }), [admin, status, environment]);

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export const useAdmin = () => useContext(AdminContext);

export const ROLE_LABEL: Record<PlatformRole, string> = { SUPER_ADMIN: 'Super admin', SUPPORT: 'Support', VIEWER: 'Viewer' };
