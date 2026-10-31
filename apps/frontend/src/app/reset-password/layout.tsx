import type { Metadata, Viewport } from 'next';
import { APP_VIEWPORT, PRIVATE_METADATA } from '@/lib/seo/site';

// Password reset link target.
export const metadata: Metadata = PRIVATE_METADATA;
export const viewport: Viewport = APP_VIEWPORT;

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
