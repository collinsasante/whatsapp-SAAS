'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Zap, ArrowRight } from 'lucide-react';
import Link from 'next/link';

const plans = [
  {
    name: 'Starter',
    monthlyPrice: 29,
    desc: 'Perfect for small teams getting started',
    color: 'border-white/[0.08]',
    highlight: false,
    badge: null,
    features: [
      '1 WhatsApp number',
      'Up to 5 agents',
      '2,000 conversations/mo',
      'Shared team inbox',
      'Basic chatbot (3 flows)',
      'Email & chat support',
      'Basic analytics',
      '1 broadcast campaign/mo',
    ],
    cta: 'Start Free Trial',
    ctaStyle: 'bg-white/[0.08] border border-white/[0.12] text-white hover:bg-white/[0.12]',
  },
  {
    name: 'Growth',
    monthlyPrice: 79,
    desc: 'For growing teams that need more power',
    color: 'border-emerald-500/40',
    highlight: true,
    badge: 'Most Popular',
    features: [
      '3 WhatsApp numbers',
      'Up to 20 agents',
      'Unlimited conversations',
      'AI-powered chatbots',
      'Broadcast campaigns (unlimited)',
      'Workflow automation',
      'Advanced analytics',
      'CRM & contact management',
      'Priority support',
      'API access',
    ],
    cta: 'Start Free Trial',
    ctaStyle: 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:shadow-[0_0_30px_rgba(16,185,129,0.5)]',
  },
  {
    name: 'Pro',
    monthlyPrice: 179,
    desc: 'For scaling businesses with heavy usage',
    color: 'border-white/[0.08]',
    highlight: false,
    badge: null,
    features: [
      '10 WhatsApp numbers',
      'Unlimited agents',
      'Unlimited everything',
      'GPT-4 AI assistant',
      'Voice & video calls',
      'Custom chatbot training',
      'White-label reports',
      'Dedicated success manager',
      'SLA guarantee (99.9%)',
      'SSO & advanced security',
    ],
    cta: 'Start Free Trial',
    ctaStyle: 'bg-white/[0.08] border border-white/[0.12] text-white hover:bg-white/[0.12]',
  },
  {
    name: 'Enterprise',
    monthlyPrice: null,
    desc: 'Custom solutions for large organizations',
    color: 'border-white/[0.08]',
    highlight: false,
    badge: null,
    features: [
      'Unlimited everything',
      'Custom integrations',
      'On-premise deployment',
      'Dedicated infrastructure',
      '24/7 phone support',
      'Custom SLA',
      'Security audit & compliance',
      'Training & onboarding',
      'Custom AI model fine-tuning',
      'Volume pricing',
    ],
    cta: 'Talk to Sales',
    ctaStyle: 'bg-white/[0.08] border border-white/[0.12] text-white hover:bg-white/[0.12]',
  },
];

export default function Pricing() {
  const [yearly, setYearly] = useState(false);

  return (
    <section id="pricing" className="py-24 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(16,185,129,0.06)_0%,transparent_60%)]" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.05] border border-white/[0.1] text-xs font-semibold text-slate-400 mb-4">
            Simple, transparent pricing
          </span>
          <h2 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight mb-4">
            Start free,{' '}
            <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">scale infinitely</span>
          </h2>
          <p className="text-lg text-slate-400 mb-8">No hidden fees. No per-message pricing. Just simple, predictable costs.</p>

          {/* Toggle */}
          <div className="inline-flex items-center gap-3 p-1 bg-white/[0.05] border border-white/[0.08] rounded-xl">
            <button
              onClick={() => setYearly(false)}
              className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition-all ${!yearly ? 'bg-white text-slate-900' : 'text-slate-400 hover:text-white'}`}
            >
              Monthly
            </button>
            <button
              onClick={() => setYearly(true)}
              className={`flex items-center gap-2 px-4 py-1.5 text-sm font-semibold rounded-lg transition-all ${yearly ? 'bg-white text-slate-900' : 'text-slate-400 hover:text-white'}`}
            >
              Yearly
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold">-20%</span>
            </button>
          </div>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans.map((plan, i) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className={`relative flex flex-col rounded-2xl border p-6 ${plan.color} ${plan.highlight ? 'bg-gradient-to-b from-emerald-500/[0.08] to-teal-500/[0.04] shadow-[0_0_40px_rgba(16,185,129,0.15)]' : 'bg-white/[0.02]'} hover:border-white/[0.2] transition-all duration-300`}
            >
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full text-xs font-bold text-white shadow-lg">
                  {plan.badge}
                </div>
              )}

              <div className="mb-5">
                <h3 className="text-base font-bold text-white mb-1">{plan.name}</h3>
                <p className="text-xs text-slate-500 mb-4">{plan.desc}</p>
                <div className="flex items-end gap-1">
                  {plan.monthlyPrice ? (
                    <>
                      <span className="text-4xl font-extrabold text-white">
                        ${yearly ? Math.floor(plan.monthlyPrice * 0.8) : plan.monthlyPrice}
                      </span>
                      <span className="text-slate-500 text-sm mb-1">/mo</span>
                      {yearly && <span className="text-emerald-400 text-xs font-semibold mb-1 ml-1">Save 20%</span>}
                    </>
                  ) : (
                    <span className="text-3xl font-extrabold text-white">Custom</span>
                  )}
                </div>
              </div>

              <Link
                href={plan.name === 'Enterprise' ? '#' : '/auth/register'}
                className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 mb-5 ${plan.ctaStyle}`}
              >
                {plan.cta} <ArrowRight size={14} />
              </Link>

              <div className="flex-1 space-y-2">
                {plan.features.map((feat) => (
                  <div key={feat} className="flex items-start gap-2">
                    <Check size={13} className={`${plan.highlight ? 'text-emerald-400' : 'text-slate-500'} flex-shrink-0 mt-0.5`} />
                    <span className="text-xs text-slate-400">{feat}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Bottom note */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4 }}
          className="flex flex-wrap justify-center items-center gap-6 mt-10 text-sm text-slate-500"
        >
          {['✓ 14-day free trial, no credit card', '✓ Cancel anytime', '✓ 99.9% uptime SLA', '✓ GDPR compliant'].map((item) => (
            <span key={item}>{item}</span>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
