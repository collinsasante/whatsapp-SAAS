import FeaturePage from '@/components/landing/FeaturePage';

export default function SharedInboxPage() {
  return (
    <FeaturePage
      eyebrow="Shared Inbox"
      title={
        <>
          One WhatsApp Number.
          <br />
          <span className="text-teal-600">Your Whole Team.</span>
        </>
      }
      lead="Stop forwarding screenshots and handing off a single phone between shifts. VerzChat gives every agent their own login into the same WhatsApp Business number, so nothing gets missed and nobody messages the same customer twice."
      sections={[
        {
          eyebrow: 'The problem',
          title: 'One-agent-per-phone doesn\'t scale.',
          body: 'Most teams start with WhatsApp Business on one person\'s phone. It works until that person is on leave, the team grows past one agent, or two people reply to the same customer without knowing it. A shared inbox fixes all three at once.',
          bullets: [
            'Every agent gets their own login — no shared passwords or a single physical phone',
            'Conversations are assigned to a specific agent so ownership is always clear',
            'Managers see every open conversation across the whole team in real time',
          ],
        },
        {
          eyebrow: 'How it works',
          title: 'Assign, note, and resolve — without leaving the thread.',
          body: 'When a message comes in, it lands in a shared queue visible to the whole team. Any agent can claim it, or a manager can assign it directly. Private internal notes let the team hand off context without the customer ever seeing it.',
          bullets: [
            'Real-time agent assignment and reassignment',
            'Private notes visible only to your team, never the customer',
            'Conversation labels and filters to organize high volume',
            'Full message history preserved for every contact',
          ],
        },
        {
          eyebrow: 'Universal takeover',
          title: 'Any agent or manager can step into any conversation.',
          body: 'If an agent is unavailable or a conversation needs escalation, any teammate with access can take over instantly — full context included, so the customer never has to repeat themselves.',
          bullets: [
            'Instant handover with complete conversation history',
            'No "wrong person owns it" conversations left unresolved',
            'Works the same whether it\'s 2 agents or 20',
          ],
        },
      ]}
      faqs={[
        {
          q: 'Do I need a separate WhatsApp number for each agent?',
          a: 'No. That\'s the whole point — every agent shares access to the same WhatsApp Business number and inbox. You only need one number, no matter how many agents you add.',
        },
        {
          q: 'Can two agents accidentally reply to the same message?',
          a: 'No. Once a conversation is assigned to an agent, it\'s clearly marked as theirs in the shared inbox, so the rest of the team can see it\'s being handled.',
        },
        {
          q: 'How many agents can I add to a shared inbox?',
          a: 'The Free plan supports 1 agent, Starter supports 2, and Pro supports up to 20 agents on a single WhatsApp channel — see the pricing on our home page for full details.',
        },
        {
          q: 'What happens if an agent goes offline mid-conversation?',
          a: 'Any other agent or manager can take over the conversation instantly with full message history, so the customer experience isn\'t interrupted.',
        },
      ]}
      related={[
        { href: '/whatsapp-broadcasts', label: 'WhatsApp Broadcast Messaging' },
        { href: '/whatsapp-crm', label: 'WhatsApp CRM' },
        { href: '/whatsapp-chatbot', label: 'WhatsApp Chatbot Automation' },
        { href: '/faq', label: 'FAQ' },
      ]}
    />
  );
}
