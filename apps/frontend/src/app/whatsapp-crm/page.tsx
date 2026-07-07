import FeaturePage from '@/components/landing/FeaturePage';

export default function WhatsappCrmPage() {
  return (
    <FeaturePage
      eyebrow="WhatsApp CRM"
      title={
        <>
          Know Every Customer.
          <br />
          <span className="text-teal-600">Every Time They Message.</span>
        </>
      }
      lead="VerzChat keeps a single contact record for every customer who's messaged your business — full conversation history included — so any agent can pick up a chat with the full picture, not just the last message."
      sections={[
        {
          eyebrow: 'One record, every channel',
          title: 'Every conversation, tied to one contact.',
          body: 'When a customer messages you on WhatsApp, VerzChat automatically links it to their contact record. Every past conversation, note, and interaction is right there — no digging through old chat threads.',
          bullets: [
            'Unified contact profile with full conversation history',
            'Add custom fields and notes to any contact',
            'Search contacts instantly across your whole customer base',
          ],
        },
        {
          eyebrow: 'Built for teams',
          title: 'Context travels with the conversation, not the agent.',
          body: 'Because every agent shares the same contact database, a customer never has to re-explain their situation just because a different agent picked up the chat.',
          bullets: [
            'Internal notes visible to your team, never the customer',
            'Conversation labels to segment and filter contacts',
            'Full history preserved even if an agent leaves the team',
          ],
        },
        {
          eyebrow: 'Reporting',
          title: 'Real-time analytics on every contact relationship.',
          body: 'Track conversation volume, response times, and resolution rates per contact and across your whole customer base, directly in the dashboard.',
          bullets: [
            'Response time and resolution rate tracking',
            'Conversation volume trends over time',
            'No separate analytics tool required',
          ],
        },
      ]}
      faqs={[
        {
          q: 'Is VerzChat a full CRM or just a WhatsApp inbox?',
          a: 'VerzChat focuses on the messaging side of customer relationship management: unified contact records, full conversation history, notes, and labels — purpose-built around WhatsApp conversations rather than a general-purpose sales pipeline tool.',
        },
        {
          q: 'Can I export my contacts and conversation history?',
          a: 'Yes. Contacts and conversation history are exportable from your dashboard at any time.',
        },
        {
          q: 'Does every agent see the same contact information?',
          a: 'Yes — all agents on your team share the same contact database and conversation history, so context is never lost when a conversation changes hands.',
        },
        {
          q: 'How many contacts can I store?',
          a: 'The Free and Starter plans support unlimited contacts on a single WhatsApp channel; the Pro plan supports up to 20,000 contacts across up to 5 WhatsApp channels.',
        },
      ]}
      related={[
        { href: '/shared-inbox', label: 'Shared WhatsApp Inbox' },
        { href: '/whatsapp-broadcasts', label: 'WhatsApp Broadcast Messaging' },
        { href: '/whatsapp-chatbot', label: 'WhatsApp Chatbot Automation' },
        { href: '/faq', label: 'FAQ' },
      ]}
    />
  );
}
