import 'bootstrap/dist/css/bootstrap.min.css';
import '@/styles/landing.css';
import Navbar from '@/components/landing/Navbar';
import Footer from '@/components/landing/Footer';
import { buildMetadata, breadcrumbSchema, webPageSchema } from '@/lib/seo';

export const metadata = buildMetadata({
  title: 'WhatsApp Chatbot & Automation',
  description:
    'Automate routine WhatsApp replies with no-code keyword triggers and chatbot flows. Hand off to a live agent instantly, with full context, whenever the bot gets stuck.',
  path: '/whatsapp-chatbot',
  keywords: [
    'WhatsApp chatbot',
    'WhatsApp automation',
    'WhatsApp auto reply',
    'WhatsApp business chatbot builder',
    'WhatsApp keyword triggers',
  ],
  ogImageAlt: 'VerzChat WhatsApp chatbot automation',
});

const pageBreadcrumb = breadcrumbSchema('/whatsapp-chatbot', [
  { name: 'Home', path: '/' },
  { name: 'WhatsApp Chatbot', path: '/whatsapp-chatbot' },
]);

const pageSchema = webPageSchema({
  path: '/whatsapp-chatbot',
  name: 'WhatsApp Chatbot & Automation — VerzChat',
  description:
    'Automate routine WhatsApp replies with no-code keyword triggers and chatbot flows. Hand off to a live agent instantly when the bot gets stuck.',
  hasBreadcrumb: true,
});

export default function WhatsappChatbotLayout({ children }: { children: React.ReactNode }) {
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
