import 'bootstrap/dist/css/bootstrap.min.css';
import '@/styles/landing.css';
import Navbar from '@/components/landing/Navbar';
import Footer from '@/components/landing/Footer';
import { buildMetadata, breadcrumbSchema, webPageSchema } from '@/lib/seo';

export const metadata = buildMetadata({
  title: 'WhatsApp CRM — Contact & Conversation Management',
  description:
    'A unified contact record for every customer, with full WhatsApp conversation history in one place. See who your customers are and what they\'ve already told you before you reply.',
  path: '/whatsapp-crm',
  keywords: [
    'WhatsApp CRM',
    'WhatsApp contact management',
    'CRM for WhatsApp business',
    'customer conversation history WhatsApp',
    'WhatsApp customer database',
  ],
  ogImageAlt: 'VerzChat WhatsApp CRM contact management',
});

const pageBreadcrumb = breadcrumbSchema('/whatsapp-crm', [
  { name: 'Home', path: '/' },
  { name: 'WhatsApp CRM', path: '/whatsapp-crm' },
]);

const pageSchema = webPageSchema({
  path: '/whatsapp-crm',
  name: 'WhatsApp CRM — VerzChat',
  description:
    'A unified contact record for every customer, with full WhatsApp conversation history in one place.',
  hasBreadcrumb: true,
});

export default function WhatsappCrmLayout({ children }: { children: React.ReactNode }) {
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
