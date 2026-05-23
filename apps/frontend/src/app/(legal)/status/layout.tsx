import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'System Status — VerzChat',
  description: 'VerzChat real-time system status — check uptime, incidents, and service health.',
  alternates: { canonical: '/status' },
};

export default function StatusLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
