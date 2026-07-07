export interface BlogSection {
  heading?: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  /** ISO date string. Real publish date, not a build-time fallback (see sitemap.ts). */
  publishedDate: string;
  updatedDate?: string;
  targetKeyword: string;
  readTimeMinutes: number;
  related: { href: string; label: string };
  sections: BlogSection[];
}

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: 'how-to-set-up-a-shared-whatsapp-inbox-for-your-team',
    title: 'How to Set Up a Shared WhatsApp Inbox for Your Team',
    excerpt:
      'A step-by-step guide to moving your business off a single phone and onto a shared WhatsApp inbox that your whole team can use together.',
    publishedDate: '2026-06-10',
    targetKeyword: 'how to share one WhatsApp number with a team',
    readTimeMinutes: 7,
    related: { href: '/shared-inbox', label: 'Shared WhatsApp Inbox' },
    sections: [
      {
        paragraphs: [
          'If your business messages customers on WhatsApp, you\'ve probably hit the same wall every growing team hits: one phone, one login, one person who can reply. It works when it\'s just you. It stops working the moment you hire a second person, go on leave, or get busy enough that messages start piling up unanswered.',
          'A shared WhatsApp inbox solves this by giving every team member their own access to the same WhatsApp Business number — without buying a new phone or number for each person. Here\'s how to actually set one up, step by step.',
        ],
      },
      {
        heading: '1. Get on the WhatsApp Business API (not just the app)',
        paragraphs: [
          'The free WhatsApp Business app is built for one device, one login. It\'s fine for a solo shop, but it can\'t support multiple agents working the same number at once. To share a number across a team, your business needs to connect through the official WhatsApp Business API — the same infrastructure Meta provides to business messaging platforms.',
          'You don\'t need to build this integration yourself. Shared inbox platforms like VerzChat handle the Meta API connection for you: you either port your existing WhatsApp Business number or register a new one, and the platform takes care of the technical setup.',
        ],
      },
      {
        heading: '2. Decide how conversations get assigned',
        paragraphs: [
          'Before inviting your team, decide how incoming messages will be distributed. Most teams pick one of two models:',
        ],
        bullets: [
          'Claim-based: messages land in a shared queue and any available agent claims one to work on.',
          'Assigned: a manager or automated rule routes each conversation to a specific agent based on topic, language, or workload.',
        ],
      },
      {
        heading: '3. Set up conversation ownership and handoff rules',
        paragraphs: [
          'The biggest risk with a shared inbox isn\'t missed messages — it\'s two agents replying to the same customer without realizing it. Fix this with clear ownership: once someone claims or is assigned a conversation, it should be visibly marked as theirs to the rest of the team.',
          'You also need a handoff plan for when an agent goes offline mid-conversation. Look for a platform that supports instant takeover — where any other agent or manager can step into an open conversation with full message history, so the customer never has to repeat themselves.',
        ],
      },
      {
        heading: '4. Add internal notes for context that shouldn\'t reach the customer',
        paragraphs: [
          'Agents need a way to leave context for each other — "this customer already got a refund, don\'t offer another one" or "escalate if they message again" — without it appearing in the customer-facing thread. Internal notes attached to the conversation (not the message itself) solve this cleanly.',
        ],
      },
      {
        heading: '5. Invite your team and set roles',
        paragraphs: [
          'Once the number is connected and your workflow is decided, invite your team members. Give managers visibility into every conversation and the ability to reassign; give agents access to their assigned and unassigned queues. Most platforms support role-based permissions so you don\'t have to give every agent full account access.',
        ],
      },
      {
        heading: '6. Watch response time from day one',
        paragraphs: [
          'The whole point of a shared inbox is faster, more consistent replies. Track average response time from the start so you can tell whether the new setup is actually working — and whether you need to add more agents as volume grows.',
        ],
      },
      {
        heading: 'Doing this in VerzChat',
        paragraphs: [
          'VerzChat is built around exactly this workflow: connect one WhatsApp Business number, invite your team, and every agent gets their own login into a shared inbox with assignment, private notes, and instant takeover built in. See the full feature breakdown on the shared inbox page, or book a demo to see it running on a real WhatsApp number.',
        ],
      },
    ],
  },
  {
    slug: 'whatsapp-broadcast-message-rules-limits-best-practices',
    title: 'WhatsApp Broadcast Messages: Rules, Limits, and Best Practices',
    excerpt:
      'What you actually need to know before sending a WhatsApp broadcast campaign — templates, opt-in requirements, quality ratings, and how to avoid getting your number restricted.',
    publishedDate: '2026-06-18',
    targetKeyword: 'WhatsApp broadcast message rules',
    readTimeMinutes: 8,
    related: { href: '/whatsapp-broadcasts', label: 'WhatsApp Broadcast Messaging' },
    sections: [
      {
        paragraphs: [
          'WhatsApp broadcast messaging can be one of the highest-converting channels a business has — open rates on WhatsApp routinely beat email by a wide margin. But WhatsApp enforces rules around business-initiated messaging that don\'t exist on other channels, and getting them wrong can get your number restricted. Here\'s what to actually know before you send your first campaign.',
        ],
      },
      {
        heading: 'Rule 1: You need an approved template to start a conversation',
        paragraphs: [
          'WhatsApp requires that any message your business sends first — meaning the customer hasn\'t messaged you in the last 24 hours — use a pre-approved message template. You submit templates (with placeholders for personalization) to Meta for review, and once approved, you can send them to any customer who\'s opted in.',
          'This is different from free-text replies inside an active conversation, which don\'t need template approval. Templates only apply to business-initiated outreach — which is exactly what a broadcast campaign is.',
        ],
      },
      {
        heading: 'Rule 2: Customers must opt in — you can\'t just import a contact list',
        paragraphs: [
          'WhatsApp\'s commerce policy requires that customers have opted in to receive messages from your business before you broadcast to them. A phone number existing in your CRM is not the same as consent. Common valid opt-in methods include a customer messaging you first, checking a box during checkout, or replying "yes" to a specific opt-in prompt.',
          'Sending to a list without proper opt-in is the single most common reason broadcast campaigns get flagged — and it damages the metric that matters most: your quality rating.',
        ],
      },
      {
        heading: 'Rule 3: Your quality rating determines how many people you can message',
        paragraphs: [
          'Every WhatsApp Business number has a quality rating based on how recipients respond — blocks, reports, and low engagement pull it down; replies and low block rates keep it healthy. Your rating determines your messaging tier, which caps how many unique customers you can contact with business-initiated messages in a rolling 24-hour window. Numbers with a low quality rating get throttled or restricted; numbers with a high quality rating unlock higher limits over time.',
          'In practice, this means blasting your entire contact list with an irrelevant promotion isn\'t just bad practice — it can directly shrink how many people you\'re allowed to message next month.',
        ],
      },
      {
        heading: 'Best practice: segment before you send',
        paragraphs: [
          'Don\'t send every campaign to every contact. Segment by purchase history, engagement, or stated interest so each broadcast is relevant to the people receiving it. Relevant messages get replies and clicks, which protects your quality rating; irrelevant ones get blocked, which damages it.',
        ],
      },
      {
        heading: 'Best practice: personalize beyond the first name',
        paragraphs: [
          'Template placeholders support more than just inserting a name. Reference the specific order, appointment, or product the customer engaged with. A broadcast that reads like it was written for that one customer performs better than a generic blast, and it\'s far less likely to get reported.',
        ],
      },
      {
        heading: 'Best practice: track delivery, read, and click rates per campaign',
        paragraphs: [
          'Treat every broadcast like a test. If delivery rates drop, something\'s wrong with your number\'s standing or your contact list quality. If read rates are high but clicks are low, the offer or call-to-action needs work. Without campaign-level tracking, you\'re broadcasting blind.',
        ],
      },
      {
        heading: 'Doing this in VerzChat',
        paragraphs: [
          'VerzChat sends broadcasts through the official WhatsApp Business API, handles template submission and approval from the dashboard, and reports delivery, read, and click rates for every campaign in real time. See the full feature breakdown on the WhatsApp broadcasts page, or book a demo to see a live campaign report.',
        ],
      },
    ],
  },
  {
    slug: 'whatsapp-crm-vs-traditional-crm',
    title: "WhatsApp CRM vs Traditional CRM: What's Actually Different",
    excerpt:
      'Traditional CRMs weren\'t built around messaging. Here\'s what changes when your customer relationship data lives inside WhatsApp conversations instead of a separate sales database.',
    publishedDate: '2026-06-25',
    targetKeyword: 'WhatsApp CRM vs CRM',
    readTimeMinutes: 6,
    related: { href: '/whatsapp-crm', label: 'WhatsApp CRM' },
    sections: [
      {
        paragraphs: [
          'Traditional CRMs like the ones sales teams have used for two decades were built around a pipeline: leads, deals, stages, close dates. WhatsApp CRM tools are built around something different — the conversation itself. If your customers primarily reach you through WhatsApp, the difference matters more than it sounds.',
        ],
      },
      {
        heading: 'Traditional CRM: the conversation is an attachment',
        paragraphs: [
          'In a traditional CRM, a customer record is the primary object, and any messaging history is bolted on as a log or integration — often a summary, not the actual back-and-forth. To see what was really said, an agent frequently has to leave the CRM and check a separate messaging tool.',
          'This works fine when messaging is a secondary channel to email or phone calls. It breaks down when WhatsApp is the primary way customers reach you, because the CRM record and the actual conversation live in two different places.',
        ],
      },
      {
        heading: 'WhatsApp CRM: the conversation is the record',
        paragraphs: [
          'A WhatsApp-native CRM flips this: the contact record is built from the conversation itself. Every message, every note, every past interaction lives under one contact, in the order it actually happened. An agent opens a chat and sees the complete history — no switching tools, no summary that\'s missing context.',
        ],
      },
      {
        heading: 'Where this actually matters',
        paragraphs: [
          'The difference shows up most in three situations:',
        ],
        bullets: [
          'Hand-offs between agents — a new agent needs the real conversation, not a paraphrased note, to avoid asking a customer to repeat themselves.',
          'Repeat customers — someone who messaged three months ago about a different issue should be recognizable instantly, with that history visible.',
          'Multi-channel customers — if the same customer reaches out on WhatsApp and Instagram, a unified contact record avoids treating them as two separate people.',
        ],
      },
      {
        heading: 'What you give up',
        paragraphs: [
          'WhatsApp-native tools are usually not built as full sales pipeline systems — most don\'t model deal stages, forecasting, or complex multi-touch sales cycles the way a dedicated sales CRM does. If your business runs a long, multi-stakeholder B2B sales process, a traditional CRM (or both tools working together) may still be the better fit for the deal-tracking side.',
          'What you gain in exchange is that every customer-facing conversation is fully preserved, searchable, and shared across your team by default — which matters most for support, order management, and high-volume customer messaging rather than long sales cycles.',
        ],
      },
      {
        heading: 'How to decide which you need',
        paragraphs: [
          'If your team\'s primary job is responding to and resolving customer conversations — support, order queries, bookings, high-volume sales follow-up — a WhatsApp-native CRM will feel dramatically faster day to day, because the tool matches the actual job. If your team\'s primary job is managing a long, staged sales pipeline with only occasional WhatsApp contact, a traditional CRM (possibly with a lightweight WhatsApp integration) is likely the better starting point.',
        ],
      },
      {
        heading: 'Doing this in VerzChat',
        paragraphs: [
          'VerzChat keeps a unified contact record for every customer who messages your business, with full conversation history, notes, and labels — shared across your whole team. See the full feature breakdown on the WhatsApp CRM page, or book a demo to see a real contact history in action.',
        ],
      },
    ],
  },
];

export function getBlogPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}
