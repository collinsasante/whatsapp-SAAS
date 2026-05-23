import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from 'react-hot-toast';
import { ThemeProvider } from '@/components/shared/ThemeProvider';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'VerzChat',
  description: 'VerzChat — Multi-channel Business Messaging Platform',
  icons: {
    icon: [{ url: '/icon.png' }],
    apple: [{ url: '/icon.png' }],
  },
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
