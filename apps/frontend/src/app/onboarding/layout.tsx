import type { Metadata, Viewport } from 'next';
import { APP_VIEWPORT, PRIVATE_METADATA } from '@/lib/seo/site';

export const metadata: Metadata = PRIVATE_METADATA;
export const viewport: Viewport = APP_VIEWPORT;

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-green-50">
      {children}
    </div>
  );
}
