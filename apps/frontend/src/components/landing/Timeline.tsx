import { Database, Settings, Zap, Trophy } from 'lucide-react';

const WEEKS = [
  {
    week: 'Week 1',
    icon: Database,
    color: 'teal',
    title: 'Data Ingestion',
    tasks: ['Import 30+ days of chat history', 'Extract language patterns & tone', 'Map product catalog & FAQs', 'Identify top 20 customer intents'],
  },
  {
    week: 'Week 2',
    icon: Settings,
    color: 'blue',
    title: 'Tone Calibration',
    tasks: ['Fine-tune empathy parameters', 'Calibrate escalation thresholds', 'Test against edge-case scenarios', 'Daily review of AI outputs'],
  },
  {
    week: 'Week 3',
    icon: Zap,
    color: 'purple',
    title: 'Live Beta',
    tasks: ['Deploy to 20% of traffic', 'Real-time feedback collection', 'Weekly performance check-in', 'Rapid iteration on failures'],
  },
  {
    week: 'Week 4',
    icon: Trophy,
    color: 'emerald',
    title: 'Full Deployment',
    tasks: ['100% traffic rollout', 'End-of-month evaluation', 'Response quality scoring', 'Business goal alignment report'],
  },
];

const COLORS: Record<string, { dot: string; icon: string; border: string; num: string }> = {
  teal:    { dot: 'bg-teal-500',    icon: 'bg-teal-500/10 text-teal-400 border-teal-500/25',    border: 'border-teal-500/20',    num: 'text-teal-400' },
  blue:    { dot: 'bg-blue-500',    icon: 'bg-blue-500/10 text-blue-400 border-blue-500/25',    border: 'border-blue-500/20',    num: 'text-blue-400' },
  purple:  { dot: 'bg-purple-500',  icon: 'bg-purple-500/10 text-purple-400 border-purple-500/25', border: 'border-purple-500/20', num: 'text-purple-400' },
  emerald: { dot: 'bg-emerald-500', icon: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25', border: 'border-emerald-500/20', num: 'text-emerald-400' },
};

export default function Timeline() {
  return (
    <section id="how-it-works" className="py-24 lg:py-32" style={{ background: '#020917' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <p className="text-teal-400 text-sm font-semibold uppercase tracking-widest mb-3">30-Day Learning Timeline</p>
          <h2 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            From zero to{' '}
            <span className="bg-gradient-to-r from-teal-400 to-emerald-400 bg-clip-text text-transparent">expert AI</span>
            {' '}in a month
          </h2>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            Four structured weeks with clear milestones — each building on the last to create an AI that genuinely understands your business.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {WEEKS.map(({ week, icon: Icon, color, title, tasks }, idx) => {
            const c = COLORS[color];
            return (
              <div key={week} className={`relative p-6 rounded-2xl border bg-white/[0.02] hover:bg-white/[0.04] transition-colors ${c.border}`}>
                {/* Connector arrow */}
                {idx < WEEKS.length - 1 && (
                  <div className="hidden lg:block absolute -right-2.5 top-1/2 -translate-y-1/2 z-10">
                    <div className="w-5 h-px bg-white/15" />
                  </div>
                )}
                <div className={`inline-flex w-10 h-10 items-center justify-center rounded-xl border mb-4 ${c.icon}`}>
                  <Icon size={18} />
                </div>
                <p className={`text-xs font-semibold uppercase tracking-widest mb-1 ${c.num}`}>{week}</p>
                <h3 className="text-white font-semibold text-base mb-3">{title}</h3>
                <ul className="space-y-2">
                  {tasks.map(task => (
                    <li key={task} className="flex items-start gap-2 text-sm text-slate-400">
                      <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${c.dot}`} />
                      {task}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
