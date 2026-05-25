'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PlatformAdminRoot() {
  const router = useRouter();
  useEffect(() => { router.replace('/platform-admin/dashboard'); }, [router]);
  return null;
}
