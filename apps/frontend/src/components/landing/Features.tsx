import { Bot, Inbox, Megaphone, Phone, GitBranch, BarChart3 } from 'lucide-react';

const FEATURES = [
  {
    icon: Bot,
    color: 'teal',
    title: 'Adaptive AI Responses',
    desc: 'Trains on your actual conversations — learns your tone, your products, and your quirks. Never sounds generic.',
  },
  {
    icon: Inbox,
    color: 'blue',
    title: 'Unified Omni-Channel Inbox',
    desc: 'WhatsApp, Instagram, Facebook Messenger — all in one fast, collaborative inbox with full conversation history.',
  },
  {
    icon: Megaphone,
    color: 'purple',
    title: 'Smart Broadcast Campaigns',
    desc: 'Send personalized campaigns at scale using Meta-approved templates with rich media and deep analytics.',
  },
  {
    icon: Phone,
    color: 'orange',
    title: 'Integrated VoIP Calls',
    desc: 'Inbound and outbound calls with recording, warm transfers, and full call logs in the conversation thread.',
  },
  {
    icon: GitBranch,
    color: 'rose',
    title: 'Smart Escalation Engine',
    desc: 'AI detects when to hand off — routing to the right human agent with full context and zero awkward transitions.',
  },
  {
    icon: BarChart3,
    color: 'green',
    title: 'Performance Analytics',
    desc: 'Real-time dashboards for CSAT, response times, AI accuracy rates, and conversation outcomes.',
  },
];

const COLORS: Record<string, string> = {
  teal:   'bg-teal-500/10   text-teal-400   border-teal-500/25',
  blue:   'bg-blue-500/10   text-blue-400   border-blue-500/25',
  purple: 'bg-purple-500/10 text-purple-400 border-purple-500/25',
  orange: 'bg-orange-500/10 text-orange-400 border-orange-500/25',
  rose:   'bg-rose-500/10   text-rose-400   border-rose-500/25',
  green:  'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
};

export default function Features() {
  return (
    <section id="features" className="py-24 lg:py-32" style={{ background: '#020917' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <p className="text-teal-400 text-sm font-semibold uppercase tracking-widest mb-3">Platform Features</p>
          <h2 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Everything you need to{' '}
            <span className="bg-gradient-to-r from-teal-400 to-emerald-400 bg-clip-text text-transparent">
              delight customers
            </span>
          </h2>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            One platform combining AI intelligence, human empathy, and the channels your customers already use.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map(({ icon: Icon, color, title, desc }) => (
            <div key={title} className="group p-6 rounded-2xl border border-white/8 bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/15 transition-all duration-300">
              <div className={`inline-flex w-11 h-11 items-center justify-center rounded-xl border mb-4 ${COLORS[color]}`}>
                <Icon size={20} />
              </div>
              <h3 className="text-white font-semibold text-base mb-2">{title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
