import Link from 'next/link';
import { CheckCircle2, Zap } from 'lucide-react';

const PLANS = [
  {
    name: 'Starter',
    price: '29',
    period: '/mo',
    desc: 'Perfect for small teams getting started with AI customer support.',
    cta: 'Get started',
    highlight: false,
    features: [
      '1 WhatsApp channel',
      'Up to 1,000 conversations/mo',
      'VerzAI with 7-day training',
      'Unified inbox',
      '2 team seats',
      'Email support',
    ],
  },
  {
    name: 'Growth',
    price: '89',
    period: '/mo',
    desc: 'For growing businesses that need full AI power across all channels.',
    cta: 'Start free trial',
    highlight: true,
    badge: 'Most popular',
    features: [
      '3 channels (WhatsApp, Instagram, Messenger)',
      'Unlimited conversations',
      'VerzAI with 30-day deep training',
      'Smart escalation engine',
      'Broadcast campaigns',
      '10 team seats',
      'Priority support',
      'Analytics dashboard',
    ],
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    desc: 'For large teams with custom workflows, SLAs, and compliance needs.',
    cta: 'Contact sales',
    highlight: false,
    features: [
      'Unlimited channels & seats',
      'Dedicated AI model training',
      'Custom knowledge base',
      'VoIP calls + call recording',
      'SSO & advanced security',
      'Dedicated account manager',
      'Custom SLA',
      'White-labeling available',
    ],
  },
];

export default function Pricing() {
  return (
    <section id="pricing" className="py-24 lg:py-32 relative overflow-hidden" style={{ background: '#040d1a' }}>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_100%,rgba(20,184,166,0.06)_0%,transparent_60%)] pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <p className="text-teal-400 text-sm font-semibold uppercase tracking-widest mb-3">Pricing</p>
          <h2 className="text-4xl sm:text-5xl font-bold text-white mb-4">Simple, transparent pricing</h2>
          <p className="text-slate-400 text-lg max-w-xl mx-auto">
            Start free for 14 days. No credit card required. Cancel anytime.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-5 max-w-5xl mx-auto">
          {PLANS.map(plan => (
            <div
              key={plan.name}
              className={`relative flex flex-col p-6 rounded-2xl border transition-all duration-300 ${
                plan.highlight
                  ? 'border-teal-500/50 bg-gradient-to-b from-teal-500/10 to-teal-500/5 shadow-2xl shadow-teal-500/10'
                  : 'border-white/8 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]'
              }`}
            >
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-teal-500 text-white text-xs font-bold rounded-full shadow-lg shadow-teal-500/30">
                  {plan.badge}
                </div>
              )}

              <div className="mb-5">
                <h3 className="text-white font-semibold text-lg mb-1">{plan.name}</h3>
                <p className="text-slate-400 text-sm">{plan.desc}</p>
              </div>

              <div className="mb-6">
                <span className="text-4xl font-extrabold text-white">
                  {plan.price === 'Custom' ? '' : '$'}{plan.price}
                </span>
                <span className="text-slate-400 text-sm ml-1">{plan.period}</span>
              </div>

              <ul className="space-y-2.5 mb-8 flex-1">
                {plan.features.map(f => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-slate-300">
                    <CheckCircle2 size={15} className="text-teal-400 flex-shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>

              <Link
                href={plan.name === 'Enterprise' ? '#' : '/register'}
                className={`flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all duration-200 ${
                  plan.highlight
                    ? 'bg-teal-500 hover:bg-teal-400 text-white shadow-lg shadow-teal-500/25 hover:shadow-teal-500/40 hover:-translate-y-px'
                    : 'bg-white/8 hover:bg-white/12 text-white border border-white/12'
                }`}
              >
                {plan.highlight && <Zap size={13} strokeWidth={2.5} />}
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
