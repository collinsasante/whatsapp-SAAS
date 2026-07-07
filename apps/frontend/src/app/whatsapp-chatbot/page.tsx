import FeaturePage from '@/components/landing/FeaturePage';

export default function WhatsappChatbotPage() {
  return (
    <FeaturePage
      eyebrow="Automation"
      title={
        <>
          Let the Bot Handle FAQs.
          <br />
          <span className="text-teal-600">You Handle the Rest.</span>
        </>
      }
      lead="Set up keyword-triggered chatbot flows in minutes — no code, no developer. The bot answers routine questions 24/7, and when it can't help, it hands off to a live agent instantly with full conversation context."
      sections={[
        {
          eyebrow: 'No-code flow builder',
          title: 'Build automation without writing a line of code.',
          body: 'Define keywords like "price", "hours", or "order" and set automatic replies. Route conversations to the right team, send welcome messages on first contact, or escalate unresolved chats after a set time.',
          bullets: [
            'Keyword-triggered automatic replies',
            'Automatic routing to the right team or agent',
            'Welcome messages for first-time contacts',
            'Time-based escalation for unresolved conversations',
          ],
        },
        {
          eyebrow: 'AI-assisted replies',
          title: 'Verz AI suggests replies your agents can send in one click.',
          body: 'Beyond fixed keyword flows, Verz AI reads each conversation in context and drafts a relevant, on-brand reply. Agents stay in control — they can accept, edit, or ignore every suggestion.',
          bullets: [
            'AI-powered reply suggestions trained on your knowledge base',
            'Never sends automatically — a human always approves',
            'Speeds up repetitive replies without losing the human touch',
          ],
        },
        {
          eyebrow: 'Always available',
          title: 'First response, even outside business hours.',
          body: 'Automation means customers get an instant first response any time they message — day, night, or weekend — and a live agent picks up the more complex cases when your team is back online.',
          bullets: [
            'Instant first response 24/7',
            'Live agent handoff with full context when needed',
            'Reduces repetitive workload on your support team',
          ],
        },
      ]}
      faqs={[
        {
          q: 'Do I need a developer to set up the chatbot?',
          a: 'No. The chatbot flow builder is no-code — define keywords and replies directly from your dashboard.',
        },
        {
          q: 'Can the chatbot hand off to a live agent?',
          a: 'Yes. Whenever the bot can\'t resolve a question, or a customer asks for a human, the conversation hands off instantly to a live agent with full context — the customer never has to repeat themselves.',
        },
        {
          q: 'Is the AI assistant included in every plan?',
          a: 'AI reply suggestions and chatbot automation are included on the Pro plan. See our pricing on the home page for full plan details.',
        },
        {
          q: 'Does the AI ever send messages automatically?',
          a: 'No. Verz AI only suggests replies — your agents always review, edit, or send them. The AI never messages a customer on its own.',
        },
      ]}
      related={[
        { href: '/shared-inbox', label: 'Shared WhatsApp Inbox' },
        { href: '/whatsapp-broadcasts', label: 'WhatsApp Broadcast Messaging' },
        { href: '/whatsapp-crm', label: 'WhatsApp CRM' },
        { href: '/faq', label: 'FAQ' },
      ]}
    />
  );
}
