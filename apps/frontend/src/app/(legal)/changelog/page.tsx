import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Changelog: VerzChat',
  description: 'VerzChat product changelog, see what\'s new, improved, and fixed in each release.',
  alternates: { canonical: '/changelog' },
};

const entries = [
  {
    version: '2.8.3',
    date: '30 Oct 2026',
    tag: 'Fix',
    tagColor: 'bg-orange-100 text-orange-700',
    items: [
      { type: 'fixed', text: 'Large images failed to send on WhatsApp with "Media upload error". WhatsApp refuses images over 5 MB, so larger images are now converted to JPEG and, only if still too large, scaled down. Smaller JPEG and PNG images are sent exactly as before.' },
      { type: 'fixed', text: 'WebP and GIF images could also fail to send. They are now converted to JPEG first (a GIF is sent as a still image).' },
    ],
  },
  {
    version: '2.8.0',
    date: '26 Oct 2026',
    tag: 'Feature',
    tagColor: 'bg-blue-100 text-blue-700',
    items: [
      { type: 'new', text: 'Reply deadline setting. In Manage, an admin chooses how many minutes (1 to 1,440) a customer who asked for a person can wait. The dashboard alert and the inbox use it.' },
      { type: 'new', text: 'Dashboard rebuilt for owners: four headline numbers (conversations, new customers, median first response, resolution rate), alert tiles that open the matching inbox view, and a conversation trend.' },
      { type: 'new', text: 'Products, Orders, Revenue and Tasks pages rebuilt on one layout with a summary, search and filters, and a side panel for details and actions.' },
      { type: 'improved', text: 'Revenue "You keep" is now calculated as gross sales minus refunds minus the platform fee. The old page understated refunds, so its figure was too high whenever there had been a refund.' },
      { type: 'fixed', text: 'Messenger and Instagram: a reply sent from outside VerzChat (the Page inbox or Meta Business Suite) now appears in the conversation.' },
      { type: 'fixed', text: 'A text message that was delivered but kept showing the sending clock now corrects itself after about 40 seconds.' },
      { type: 'fixed', text: 'The app no longer stretches wider than a phone screen when a page has wide content.' },
    ],
  },
  {
    version: '2.7.0',
    date: '24 Oct 2026',
    tag: 'Major',
    tagColor: 'bg-purple-100 text-purple-700',
    items: [
      { type: 'fixed', text: 'Suspending a workspace or a user now ends their access straight away. Before, people who were already signed in could keep working.' },
      { type: 'new', text: 'Analytics rebuilt around three questions: what is happening, why, and what to do next, with date range, previous-period comparison and channel filters.' },
      { type: 'improved', text: 'Dashboard rebuilt as an owner overview with a Today, 7 days, 30 days or custom range and comparison to the previous period.' },
      { type: 'improved', text: 'Inbox links can open pre-filtered by status, assignee or channel.' },
      { type: 'fixed', text: 'A message that failed to send no longer counts as the first reply to a customer, so median first-reply times are no longer too fast.' },
      { type: 'improved', text: 'Revenue now comes from Commerce orders, per currency. It no longer shows VerzChat subscription billing.' },
      { type: 'improved', text: 'A consistent look across every signed-in page: one page-title size, one set of status colours, readable status colours in dark mode, and visible keyboard focus.' },
    ],
  },
  {
    version: '2.6.0',
    date: '23 Oct 2026',
    tag: 'Feature',
    tagColor: 'bg-blue-100 text-blue-700',
    items: [
      { type: 'new', text: 'Messenger and Instagram now do more of what WhatsApp does in the inbox: media is uploaded to Meta directly, replies quote the message, delivered and read ticks update, and chatbot flows, automations and Verz AI run on inbound messages with plain-text replies. Customers outside your own team can use Messenger and Instagram only after Meta\'s App Review.' },
      { type: 'fixed', text: 'Messenger and Instagram contacts show a name from Meta, or "Messenger user" / "Instagram user", instead of "Unknown".' },
    ],
  },
  {
    version: '2.4.0',
    date: '23 Oct 2026',
    tag: 'Feature',
    tagColor: 'bg-blue-100 text-blue-700',
    items: [
      { type: 'new', text: 'Instagram: an account picker like Facebook\'s, so only the account you choose is connected. Messages to a connected Instagram account arrive in the inbox and agents can reply with text, images, video and audio. This needs Meta setup first.' },
      { type: 'new', text: 'Disconnect on every channel card connected through a login (Instagram, TikTok, Telegram). A channel with history is disconnected and kept so past conversations keep their channel.' },
      { type: 'fixed', text: 'Workspaces that manage more than a few Facebook Pages now see all of them when connecting.' },
      { type: 'fixed', text: 'The Channels page no longer sends stored credentials (Telegram bot tokens, TikTok and Instagram access tokens) to every workspace member.' },
      { type: 'improved', text: 'Knowledge base changes, uploads and website import are now limited to admins.' },
    ],
  },
  {
    version: '2.2.0',
    date: '20 Sep 2026',
    tag: 'Feature',
    tagColor: 'bg-blue-100 text-blue-700',
    items: [
      { type: 'new', text: 'WhatsApp via QR (the unofficial linked-device connection) now works end to end.' },
      { type: 'new', text: 'Facebook Messenger channel.' },
      { type: 'improved', text: 'A WhatsApp QR session now recovers cleanly from an expired QR code, and two service instances can no longer run the same session at once.' },
    ],
  },
  {
    version: '2.0.0',
    date: '21 May 2026',
    tag: 'Major',
    tagColor: 'bg-purple-100 text-purple-700',
    items: [
      { type: 'new', text: 'Email verification on signup, and 2-step authentication by email code.' },
      { type: 'new', text: 'Knowledge base upload (PDF, TXT, CSV, MD) and website import.' },
      { type: 'new', text: 'Live dashboard numbers and always-visible message read receipts.' },
      { type: 'improved', text: 'Campaigns, dashboard and inbox work on mobile screens.' },
    ],
  },
  {
    version: '1.4.0',
    date: '19 May 2026',
    tag: 'Major',
    tagColor: 'bg-purple-100 text-purple-700',
    items: [
      { type: 'new', text: 'Verz AI assistant: AI-powered reply suggestions trained on your knowledge base. Enable it per workspace in Settings > AI.' },
      { type: 'new', text: 'Universal takeover system, any agent can take over a conversation assigned to another agent or Verz, with a clear handover state so nothing gets confused.' },
      { type: 'new', text: 'A single Pro plan with one flat price for your whole team. Plans and prices have changed since; the current plans are on the home page.' },
      { type: 'new', text: 'Automated Postgres backups with 7-day retention on the server.' },
      { type: 'improved', text: 'Onboarding is now 2 steps: connect your WhatsApp number and your profile is fetched from Meta automatically.' },
      { type: 'improved', text: 'AI assistant now uses DeepSeek instead of Claude Haiku. Faster, cheaper, and the replies feel more natural.' },
      { type: 'fixed', text: 'Rate limiting is now applied globally across all API endpoints. Webhook endpoints are correctly exempted.' },
    ],
  },
  {
    version: '1.3.2',
    date: '17 May 2026',
    tag: 'Fix',
    tagColor: 'bg-orange-100 text-orange-700',
    items: [
      { type: 'fixed', text: 'Workspace invite emails now use the correct From address and the invite link actually works on first click.' },
      { type: 'fixed', text: 'Real-time call recording now shows up in the chat window immediately after the call ends, not just on page refresh.' },
      { type: 'fixed', text: 'Context menu in conversation list now positions itself at the exact click point instead of jumping to the corner.' },
    ],
  },
  {
    version: '1.3.0',
    date: '15 May 2026',
    tag: 'Feature',
    tagColor: 'bg-blue-100 text-blue-700',
    items: [
      { type: 'new', text: 'Optimistic media send in inbox, images and videos appear in the chat immediately when you hit send, no waiting for the server round-trip.' },
      { type: 'new', text: 'Specific address picker in the compose area, choose which connected WhatsApp number to send from when you have multiple channels.' },
      { type: 'new', text: 'Call accept guard, prevents double-accepting an incoming call if two agents click at the same time.' },
      { type: 'improved', text: 'Emoji picker replaced with a WhatsApp-style picker with search and recently used emojis.' },
      { type: 'improved', text: 'Mark as unread right-click option on conversations in the list.' },
    ],
  },
  {
    version: '1.2.0',
    date: '13 May 2026',
    tag: 'Feature',
    tagColor: 'bg-blue-100 text-blue-700',
    items: [
      { type: 'new', text: 'Platform admin panel, manage all workspaces, view usage, impersonate accounts for support. Secured with a separate admin secret.' },
      { type: 'new', text: 'Knowledge base, create articles that Verz uses to generate replies. Also has a manual "learn from recent chats" mode.' },
      { type: 'new', text: 'Feedback system, agents can submit feedback directly from the platform.' },
      { type: 'improved', text: 'Roles and permissions are now enforced on the backend. Previously only the frontend was checking.' },
    ],
  },
];

const typeStyle: Record<string, string> = {
  new: 'bg-[#f0fdf4] text-[#15803d] border border-[#bbf7d0]',
  improved: 'bg-blue-50 text-blue-700 border border-blue-200',
  fixed: 'bg-orange-50 text-orange-700 border border-orange-200',
};

export default function ChangelogPage() {
  return (
    <div className="max-w-3xl mx-auto px-5 sm:px-8 py-16">
      <div className="mb-12">
        <h1 className="text-4xl font-extrabold text-gray-900 mb-4">Changelog</h1>
        <p className="text-lg text-gray-500">
          What we shipped and when. This is a summary of the changes that matter to people using VerzChat; newest first.
        </p>
      </div>

      <div className="relative">
        <div className="absolute left-[7px] top-0 bottom-0 w-px bg-gray-200" />

        <div className="space-y-12">
          {entries.map((entry) => (
            <div key={entry.version} className="relative pl-8">
              <div className="absolute left-0 top-1.5 w-3.5 h-3.5 rounded-full bg-[#25D366] border-2 border-white shadow-sm" />

              <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className="text-lg font-extrabold text-gray-900">{entry.version}</span>
                <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${entry.tagColor}`}>{entry.tag}</span>
                <span className="text-sm text-gray-400">{entry.date}</span>
              </div>

              <ul className="space-y-3">
                {entry.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5 capitalize ${typeStyle[item.type]}`}>
                      {item.type}
                    </span>
                    <p className="text-sm text-gray-600 leading-relaxed">{item.text}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-12 pt-8 border-t border-gray-100">
        <p className="text-sm text-gray-400">
          Something broken or missing? <a href="mailto:notifications@verzchat.com" className="text-teal-700 underline">Let us know.</a>
        </p>
      </div>
    </div>
  );
}
