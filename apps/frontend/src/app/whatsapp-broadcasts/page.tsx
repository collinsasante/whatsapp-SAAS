import FeaturePage from '@/components/landing/FeaturePage';

export default function WhatsappBroadcastsPage() {
  return (
    <FeaturePage
      eyebrow="Broadcasts"
      title={
        <>
          Reach Thousands of Customers.
          <br />
          <span className="text-teal-600">One WhatsApp Campaign.</span>
        </>
      }
      lead="Upload your contact list, pick an approved WhatsApp template, and send. VerzChat's broadcast messaging runs on the official WhatsApp Business API, so every message lands in the customer's real chat — not a group, not spam."
      sections={[
        {
          eyebrow: 'How broadcasts work',
          title: 'Built on the official WhatsApp Business API.',
          body: 'Every broadcast goes through Meta\'s official infrastructure using pre-approved message templates, which means reliable delivery and no risk of your number being flagged for spam-like behavior.',
          bullets: [
            'Send to any contact segment, from a handful to thousands',
            'Messages arrive in the recipient\'s individual chat, not a group',
            'Personalize each message with customer data',
            'Schedule sends for the times your audience is most active',
          ],
        },
        {
          eyebrow: 'Track everything',
          title: 'See delivery, read, and click rates as they happen.',
          body: 'Every campaign reports back in real time from your VerzChat dashboard — no waiting for an end-of-day export or a separate analytics tool.',
          bullets: [
            'Real-time delivery and read receipts per campaign',
            'Click-through tracking on links inside your message',
            'Historical campaign performance to compare what works',
          ],
        },
        {
          eyebrow: 'Common use cases',
          title: 'Promotions, launches, and re-engagement.',
          body: 'Teams use broadcast campaigns for product launches, seasonal promotions, order and shipping updates, appointment reminders, and win-back campaigns for customers who\'ve gone quiet.',
          bullets: [
            'Promotional and marketing campaigns',
            'Order status and shipping update blasts',
            'Appointment and booking reminders',
            're-engagement campaigns for inactive customers',
          ],
        },
      ]}
      faqs={[
        {
          q: 'Will my WhatsApp number get banned for sending broadcasts?',
          a: 'No, as long as you send through the official WhatsApp Business API with approved templates — which is exactly how VerzChat broadcasts work. This is the same infrastructure Meta provides for legitimate business messaging.',
        },
        {
          q: 'Do broadcast messages arrive in a group chat?',
          a: 'No. Each recipient gets the message in their own individual chat with your business number, just like a normal WhatsApp conversation.',
        },
        {
          q: 'Can I personalize broadcast messages per customer?',
          a: 'Yes. You can insert customer data like name or order details into your approved template so each message feels individual, not mass-sent.',
        },
        {
          q: 'Do I need a WhatsApp-approved template to send a broadcast?',
          a: 'Yes — Meta requires that outbound business-initiated messages use a pre-approved template. VerzChat helps you create and submit templates for approval directly from the dashboard.',
        },
      ]}
      related={[
        { href: '/shared-inbox', label: 'Shared WhatsApp Inbox' },
        { href: '/whatsapp-crm', label: 'WhatsApp CRM' },
        { href: '/whatsapp-chatbot', label: 'WhatsApp Chatbot Automation' },
        { href: '/faq', label: 'FAQ' },
      ]}
    />
  );
}
