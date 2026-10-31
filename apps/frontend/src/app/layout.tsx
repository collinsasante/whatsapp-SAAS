import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from 'react-hot-toast';
import { ThemeProvider } from '@/components/shared/ThemeProvider';
import { NON_PRODUCTION_SITE, SITE_URL } from '@/lib/seo/site';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

// Zoom is left on for the marketing and legal pages. The signed-in app and its forms lock it in their own layouts (APP_VIEWPORT).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'VerzChat: WhatsApp Business Inbox for Teams',
    template: '%s | VerzChat',
  },
  description: 'Handle every customer WhatsApp message from one shared inbox. Official Meta API. Teams live in under 20 minutes.',
  icons: {
    icon: [{ url: '/icon.png' }],
    apple: [{ url: '/icon.png' }],
  },
  openGraph: {
    type: 'website',
    siteName: 'VerzChat',
    description: 'Handle every customer WhatsApp message from one shared inbox. Official Meta API. Teams live in under 20 minutes.',
  },
  twitter: {
    card: 'summary_large_image',
    site: '@verzchat',
  },
  // No canonical here. It was '/', which every page without its own canonical inherited, so private and utility pages declared the
  // homepage as their canonical. Each indexable page now sets its own; private pages set none.
  //
  // Staging and local builds are never indexed (the matching X-Robots-Tag response header comes from next.config.js).
  ...(NON_PRODUCTION_SITE ? { robots: { index: false, follow: false } } : {}),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className} suppressHydrationWarning>
        <ThemeProvider>
          {children}
          <Toaster
            position="top-right"
            gutter={8}
            toastOptions={{
              duration: 4000,
              style: {
                borderRadius: '12px',
                padding: '12px 16px',
                fontSize: '13px',
                fontWeight: '500',
                boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                maxWidth: '360px',
              },
              success: {
                style: { background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' },
                iconTheme: { primary: '#16a34a', secondary: '#f0fdf4' },
              },
              error: {
                style: { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' },
                iconTheme: { primary: '#dc2626', secondary: '#fef2f2' },
                duration: 5000,
              },
              loading: {
                style: { background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe' },
                iconTheme: { primary: '#2563eb', secondary: '#eff6ff' },
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
