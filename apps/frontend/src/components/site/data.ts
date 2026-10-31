/**
 * Everything the marketing page states as fact, in one place. Each entry was checked against the product code:
 * plan limits against prisma/seed.ts, channels against the backend's inbound and outbound handlers, behaviour
 * against the inbox. Do not add a claim here that the product cannot do today.
 */

export const SUPPORT_EMAIL = 'support@verzchat.com';

export type ChannelStatus = 'available' | 'rolling-out';

export interface ChannelRow {
  id: 'whatsapp-api' | 'whatsapp-qr' | 'messenger' | 'instagram';
  name: string;
  detail: string;
  status: ChannelStatus;
}

// Telegram and TikTok can be connected in the dashboard but the backend does not receive or send their messages,
// so they are deliberately absent. Add them only when messages actually flow.
export const CHANNELS: ChannelRow[] = [
  {
    id: 'whatsapp-api',
    name: 'WhatsApp Business Platform',
    detail: "Meta's official Cloud API, connected from your own WhatsApp Business account and number. Text, images, video, audio, documents and templates.",
    status: 'available',
  },
  {
    id: 'whatsapp-qr',
    name: 'WhatsApp by QR code',
    detail: 'Link a phone as a device and work from the shared inbox. It is not Meta\'s official API, so use it knowing that.',
    status: 'available',
  },
  {
    id: 'messenger',
    name: 'Facebook Messenger',
    detail: 'Built and working, with media, quoted replies and read ticks. Opening to every workspace once Meta approves our app for public use.',
    status: 'rolling-out',
  },
  {
    id: 'instagram',
    name: 'Instagram direct messages',
    detail: 'Built and working for professional accounts. Opening to every workspace once Meta approves our app for public use.',
    status: 'rolling-out',
  },
];

export interface PlanColumn {
  id: 'free' | 'starter' | 'pro';
  name: string;
  price: string;
  note: string;
  highlight?: boolean;
}

export const PLANS: PlanColumn[] = [
  { id: 'free', name: 'Free', price: '$0', note: 'No card needed' },
  { id: 'starter', name: 'Starter', price: '$16', note: 'per month' },
  { id: 'pro', name: 'Pro', price: '$25', note: 'per month, 7-day trial', highlight: true },
];

// Rows come from the plan definitions in prisma/seed.ts; only limits stated there appear.
export const PLAN_ROWS: Array<{ label: string; values: [string, string, string] }> = [
  { label: 'Agents', values: ['1', '2', '20'] },
  { label: 'WhatsApp channels', values: ['1', '1', '5'] },
  { label: 'Contacts', values: ['Unlimited', 'Unlimited', '20,000'] },
  { label: 'Messages', values: ['Unlimited', 'Unlimited', 'Unlimited'] },
  { label: 'Message templates', values: ['None', '3', 'Unlimited'] },
  { label: 'Campaigns', values: ['None', '3', 'Unlimited'] },
  { label: 'Verz AI assistant and knowledge base', values: ['None', 'None', 'Included'] },
];

export interface FaqItem {
  q: string;
  a: string;
  /** Pages that go deeper on the answer. Rendered under it; the FAQPage markup carries the answer text only. */
  links?: Array<{ href: string; label: string }>;
}

export const FAQ: FaqItem[] = [
  {
    q: 'What does VerzChat cost?',
    a: 'There is a free plan with one agent and one WhatsApp channel. Starter is $16 a month and Pro is $25 a month, and Pro begins with a 7-day trial. The table above lists what each plan includes.',
  },
  {
    q: 'Which channels can I connect today?',
    a: "WhatsApp works today, either through Meta's official WhatsApp Business Platform or by linking a phone with a QR code. Messenger and Instagram are built and are opening to every workspace as Meta approves our app. We only list what we can operate.",
  },
  {
    q: 'Do I need my own Meta account?',
    a: "For the official WhatsApp Business Platform, yes. You connect a WhatsApp Business account and phone number from your own Meta Business account. The QR option does not need one, but it is not Meta's official API.",
  },
  {
    q: 'Can Verz AI reply without a person?',
    a: 'You choose, for each workspace. In suggestion mode Verz AI drafts a reply and an agent sends it. In auto-reply mode it answers by itself. If a customer asks for a person, or the AI is not confident, the conversation moves to your Requests queue for an agent.',
  },
  {
    q: 'How do I stop the AI on one conversation?',
    a: 'An agent clicks Intervene and the conversation becomes theirs. Return to AI hands it back.',
  },
  {
    q: 'Who can see my customers\' messages?',
    a: 'Your team, inside your workspace. If you turn on Verz AI, the text of messages is sent to our AI provider to write replies, and the privacy policy names the provider and explains this. You can disconnect a channel at any time and ask us to delete your data.',
    links: [
      { href: '/privacy', label: 'Privacy policy' },
      { href: '/gdpr', label: 'GDPR and data rights' },
      { href: '/data-deletion', label: 'Data deletion' },
    ],
  },
  {
    q: 'Can I cancel?',
    a: 'Yes. Cancel from Billing in your workspace. The plan stays active until the end of the period you have paid for.',
    links: [{ href: '/terms', label: 'Terms of service' }],
  },
];
