import type { Metadata, Viewport } from 'next';
import { APP_VIEWPORT, PRIVATE_METADATA } from '@/lib/seo/site';
import PlatformAdminShell from './PlatformAdminShell';

// A server component, so it can carry the noindex metadata; the interactive shell stays a client component.
export const metadata: Metadata = PRIVATE_METADATA;
export const viewport: Viewport = APP_VIEWPORT;

export default function Layout({ children }: { children: React.ReactNode }) {
  return <PlatformAdminShell>{children}</PlatformAdminShell>;
}
