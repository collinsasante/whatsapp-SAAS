import { Database, Brain, Heart, AlertTriangle, Calendar, MessageCircle, BarChart2 } from 'lucide-react';

const PILLARS = [
  {
    num: '01',
    icon: Database,
    title: 'Data Ingestion & Training',
    desc: "30 days of real support chats, order inquiries, and follow-ups are ingested. The AI extracts your business's unique vocabulary, tone, and response patterns — nothing generic.",
    badge: '10k+ messages analyzed',
  },
  {
    num: '02',
    icon: Brain,
    title: 'Dynamic Knowledge Base',
    desc: 'Automatically builds a living knowledge base from your data: product catalog, store hours, policies, FAQs, and recurring customer scenarios — updated nightly.',
    badge: 'Auto-updates nightly',
  },
  {
    num: '03',
    icon: Heart,
    title: 'Humanized Tone Engine',
    desc: "Avoids corporate-speak. Uses the customer's name, references past interactions, and adapts phrasing to be warm, empathetic, and genuinely helpful — not scripted.",
    badge: '94% satisfaction rate',
  },
  {
    num: '04',
    icon: AlertTriangle,
    title: 'Intent Detection & Escalation',
    desc: "When the AI isn't confident, it doesn't guess. It seamlessly hands off with full context: \"I'll have a team member help you right away\" — warm, instant, zero friction.",
    badge: '<3s handoff time',
  },
  {
    num: '05',
    icon: Calendar,
    title: '30-Day Learning Timeline',
    desc: 'Week 1: data ingestion. Week 2: tone calibration. Week 3: edge-case training. Week 4: full evaluation against response quality, engagement, and user satisfaction goals.',
    badge: 'Clear weekly milestones',
  },
  {
    num: '06',
    icon: MessageCircle,
    title: 'Continuous Feedback Loop',
    desc: 'After every key interaction, customers rate the response. Feedback feeds directly back into the model — improving accuracy, warmth, and personalization every day.',
    badge: 'Daily model refinement',
  },
];

const FINAL = {
  num: '07',
  icon: BarChart2,
  title: 'Output Quality Dashboard',
  desc: 'Every AI response is logged and analyzed. A live dashboard tracks conversion rates, response times, CSAT, AI accuracy, and escalation rates — so you can measure real business impact.',
  badge: 'Real-time metrics',
};

export default function AISection() {
  return (
    <section id="ai" className="py-24 lg:py-32 relative overflow-hidden" style={{ background: '#040d1a' }}>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_25%_50%,rgba(20,184,166,0.08)_0%,transparent_65%)] pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <p className="text-teal-400 text-sm font-semibold uppercase tracking-widest mb-3">AI Architecture</p>
          <h2 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            How VerzAI learns{' '}
            <span className="bg-gradient-to-r from-teal-400 to-emerald-400 bg-clip-text text-transparent">
              your business
            </span>
          </h2>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            Seven interlocking systems turn your historical data into an AI that sounds exactly like your best team member.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 mb-5">
          {PILLARS.map(({ num, icon: Icon, title, desc, badge }) => (
            <div key={num} className="relative p-6 rounded-2xl border border-white/8 bg-gradient-to-br from-white/[0.025] to-transparent hover:border-teal-500/30 hover:from-teal-500/[0.04] transition-all duration-300">
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center">
                  <Icon size={18} className="text-teal-400" />
                </div>
                <span className="text-slate-700 font-mono text-xs font-medium">{num}</span>
              </div>
              <h3 className="text-white font-semibold text-base mb-2">{title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed mb-4">{desc}</p>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-teal-500/8 border border-teal-500/15 text-teal-400 text-xs font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-400 flex-shrink-0" />
                {badge}
              </div>
            </div>
          ))}
        </div>

        {/* Pillar 07 — full-width highlight */}
        <div className="relative p-6 sm:p-8 rounded-2xl border border-teal-500/20 bg-gradient-to-r from-teal-500/8 via-emerald-500/4 to-teal-500/8 overflow-hidden">
          <div className="absolute right-0 top-0 bottom-0 w-64 bg-gradient-to-l from-teal-500/5 to-transparent pointer-events-none" />
          <div className="relative flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <div className="w-12 h-12 rounded-xl bg-teal-500/15 border border-teal-500/25 flex items-center justify-center flex-shrink-0">
              <FINAL.icon size={22} className="text-teal-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-slate-600 font-mono text-xs">{FINAL.num}</span>
                <h3 className="text-white font-semibold text-lg">{FINAL.title}</h3>
              </div>
              <p className="text-slate-400 text-sm leading-relaxed">{FINAL.desc}</p>
            </div>
            <div className="flex-shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-teal-500/12 border border-teal-500/20 text-teal-400 text-sm font-semibold">
              <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
              {FINAL.badge}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
