import { buildMetadata, breadcrumbSchema, webPageSchema } from '@/lib/seo';

export const metadata = buildMetadata({
  title: 'System Status',
  description: 'VerzChat real-time system status — check uptime, incidents, and service health.',
  path: '/status',
});

const pageBreadcrumb = breadcrumbSchema('/status', [
  { name: 'Home', path: '/' },
  { name: 'System Status', path: '/status' },
]);

const pageSchema = webPageSchema({
  path: '/status',
  name: 'System Status — VerzChat',
  description: 'VerzChat real-time system status — check uptime, incidents, and service health.',
  hasBreadcrumb: true,
});

export default function StatusLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(pageBreadcrumb) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(pageSchema) }} />
      {children}
    </>
  );
}
