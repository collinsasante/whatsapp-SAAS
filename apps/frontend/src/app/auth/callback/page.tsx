'use client';
import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import toast from 'react-hot-toast';
import { UserRole } from '@whatsapp-platform/shared-types';

function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setAuth } = useAuthStore();

  useEffect(() => {
    const accessToken = searchParams.get('access_token');
    const userB64 = searchParams.get('user');
    const tenantB64 = searchParams.get('tenant');

    if (!accessToken || !userB64 || !tenantB64) {
      toast.error('Authentication failed. Please try again.');
      router.replace('/login');
      return;
    }

    try {
      const user = JSON.parse(atob(userB64)) as {
        id: string; email: string; name: string; role: UserRole; tenantId: string;
      };
      const tenant = JSON.parse(atob(tenantB64)) as { id: string; name: string; slug: string };
      setAuth(user, tenant, accessToken);
      toast.success(`Welcome, ${user.name}!`);
      router.replace('/dashboard');
    } catch {
      toast.error('Authentication failed. Please try again.');
      router.replace('/login');
    }
  }, [searchParams, setAuth, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-teal-600 mx-auto mb-4" />
        <p className="text-sm text-gray-500">Completing sign in…</p>
      </div>
    </div>
  );
}

export default function AuthCallbackWrapper() {
  return <Suspense><AuthCallbackPage /></Suspense>;
}
