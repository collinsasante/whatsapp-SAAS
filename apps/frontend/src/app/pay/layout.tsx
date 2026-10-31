import type { Metadata, Viewport } from 'next';
import { APP_VIEWPORT, PRIVATE_METADATA } from '@/lib/seo/site';

// /pay/<reference>: a payment link for one customer's order. Never a search result.
export const metadata: Metadata = PRIVATE_METADATA;
export const viewport: Viewport = APP_VIEWPORT;

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
