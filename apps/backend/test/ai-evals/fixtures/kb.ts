/** Fixture knowledge base seeded into a throwaway test tenant before every
 *  eval run. Every fact referenced by an eval case's `expectedFacts` must
 *  appear in one of these articles, worded consistently, so the price/URL
 *  verification-trap cases have a real ground truth to check against. */
export const FIXTURE_KB_ARTICLES: { title: string; content: string }[] = [
  {
    title: 'Pricing',
    content: [
      'VerzChat has three plans.',
      'The Free plan is GHS 0 per month, includes 1 agent and 1 WhatsApp channel.',
      'The Starter plan is GHS 200 per month, includes 2 agents, 3 templates, and 3 automations.',
      'The Pro plan is GHS 313 per month, includes 20 agents, 5 WhatsApp channels, chatbot automation, and AI reply suggestions.',
      'All plans include unlimited contacts and unlimited messages per month.',
    ].join(' '),
  },
  {
    title: 'Support Hours',
    content: 'Our support team is available Monday to Friday, 9am to 6pm GMT. You can reach us by email at support@verzchat.com.',
  },
  {
    title: 'Refund Policy',
    content: 'We offer a full refund within 14 days of your first payment if you are not satisfied. After 14 days, refunds are not available, but you can cancel anytime to stop future billing.',
  },
  {
    title: 'Onboarding Time',
    content: 'Most teams are live on VerzChat in under 20 minutes. Connect your WhatsApp Business number, invite your team, and start handling conversations immediately. No developer is required.',
  },
  {
    title: 'Supported Channels',
    content: 'VerzChat connects WhatsApp Business, Instagram Direct Messages, Facebook Messenger, Telegram, and TikTok into one shared inbox.',
  },
  {
    title: 'Verz AI Assistant',
    content: 'Verz AI is our built-in reply assistant. It reads each conversation and suggests a reply based on your knowledge base. On the Pro plan, Verz AI is included. Verz AI never sends a message without a human reviewing it unless auto-reply mode is explicitly turned on by an admin.',
  },
  {
    title: 'Data Security',
    content: 'All customer data is encrypted at rest using AES-256 and in transit using TLS 1.3. VerzChat is compliant with GDPR and NDPR. We never sell customer data to third parties.',
  },
  {
    title: 'Cancellation Policy',
    content: 'You can cancel your subscription at any time from Settings > Billing. Your workspace stays active until the end of the billing period you already paid for. Your data is retained for 90 days after cancellation before permanent deletion.',
  },
  {
    title: 'Sign Up',
    content: 'To create a VerzChat account, visit https://verzchat.com/auth/register. No credit card is required for the Free plan.',
  },
  {
    title: 'Contact Sales',
    content: 'For enterprise plans or custom pricing above 20 agents, email sales@verzchat.com or call +233 24 400 0000.',
  },
  {
    title: 'WhatsApp Template Approval',
    content: 'Broadcast messages require a WhatsApp-approved template. Templates are usually approved by Meta within 24 hours of submission. You can submit templates from Settings > Templates.',
  },
  {
    title: 'Mobile App',
    content: 'VerzChat does not currently have a native mobile app. The web dashboard is fully responsive and works well in a mobile browser.',
  },
];
