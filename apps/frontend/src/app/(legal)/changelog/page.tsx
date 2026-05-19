import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Changelog — VerzChat',
};

const entries = [
  {
    version: '1.4.0',
    date: '19 May 2026',
    tag: 'Major',
    tagColor: 'bg-purple-100 text-purple-700',
    items: [
      { type: 'new', text: 'Verz AI assistant — AI-powered reply suggestions trained on your knowledge base. Enable it per workspace in Settings > AI.' },
      { type: 'new', text: 'Universal takeover system — any agent can take over a conversation assigned to another agent or Verz, with a clear handover state so nothing gets confused.' },
      { type: 'new', text: 'Single Pro plan at GH₵150/month (approx. $12 USD). Simplified billing, one flat price for your whole team.' },
      { type: 'new', text: 'Automated Postgres backups running daily on the server with 7-day retention.' },
      { type: 'improved', text: 'Onboarding reduced from 5 steps to 2. Connect your WhatsApp number, get your profile auto-fetched from Meta, done.' },
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
      { type: 'new', text: 'Optimistic media send in inbox — images and videos appear in the chat immediately when you hit send, no waiting for the server round-trip.' },
      { type: 'new', text: 'Specific address picker in the compose area — choose which connected WhatsApp number to send from when you have multiple channels.' },
      { type: 'new', text: 'Call accept guard — prevents double-accepting an incoming call if two agents click at the same time.' },
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
      { type: 'new', text: 'Platform admin panel — manage all workspaces, view usage, impersonate accounts for support. Secured with a separate admin secret.' },
      { type: 'new', text: 'Knowledge base — create articles that Verz uses to generate replies. Also has a manual "learn from recent chats" mode.' },
      { type: 'new', text: 'Feedback system — agents can submit feedback directly from the platform.' },
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
          What we shipped and when. We update this every time something meaningful changes.
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
