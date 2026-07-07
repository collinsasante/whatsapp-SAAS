import 'bootstrap/dist/css/bootstrap.min.css';
import '@/styles/landing.css';
import Navbar from '@/components/landing/Navbar';
import Footer from '@/components/landing/Footer';
import { buildMetadata, breadcrumbSchema, webPageSchema } from '@/lib/seo';

export const metadata = buildMetadata({
  title: 'Shared WhatsApp Inbox for Teams',
  description:
    'Give your whole team access to one WhatsApp Business number. Assign conversations, add private notes, and reply together from a single shared inbox — no more one-agent-per-phone.',
  path: '/shared-inbox',
  keywords: [
    'shared WhatsApp inbox',
    'WhatsApp team inbox',
    'multiple agents one WhatsApp number',
    'WhatsApp business inbox for teams',
    'team WhatsApp business',
  ],
  ogImageAlt: 'VerzChat shared WhatsApp inbox',
});

const pageBreadcrumb = breadcrumbSchema('/shared-inbox', [
  { name: 'Home', path: '/' },
  { name: 'Shared Inbox', path: '/shared-inbox' },
]);

const pageSchema = webPageSchema({
  path: '/shared-inbox',
  name: 'Shared WhatsApp Inbox for Teams — VerzChat',
  description:
    'Give your whole team access to one WhatsApp Business number. Assign conversations, add private notes, and reply together from a single shared inbox.',
  hasBreadcrumb: true,
});

export default function SharedInboxLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="lp">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(pageBreadcrumb) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(pageSchema) }} />
      <Navbar />
      {children}
      <Footer />
    </div>
  );
}
