'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, ArrowRight } from 'lucide-react';
import Link from 'next/link';

const plans = [
  {
    name: 'Starter',
    monthly: 29,
    tagline: 'For small teams getting started with WhatsApp.',
    features: [
      '1 WhatsApp number',
      'Up to 5 agents',
      '2,000 conversations / month',
      'Shared inbox',
      'Basic chatbot (3 flows)',
      'Email support',
    ],
    cta: 'Start free trial',
    recommended: false,
  },
  {
    name: 'Growth',
    monthly: 79,
    tagline: 'For teams handling real volume across multiple channels.',
    features: [
      '3 WhatsApp numbers',
      'Up to 25 agents',
      'Unlimited conversations',
      'Broadcast campaigns',
      'AI chatbot (unlimited flows)',
      'Workflow automation',
      'Analytics dashboard',
      'CRM & contacts',
      'Priority support',
    ],
    cta: 'Start free trial',
    recommended: true,
  },
  {
    name: 'Pro',
    monthly: 179,
    tagline: 'For businesses that can\'t afford downtime or limits.',
    features: [
      '10 WhatsApp numbers',
      'Unlimited agents',
      'Everything in Growth, plus:',
      'GPT-4 AI replies',
      'Voice & video calls',
      'White-label reports',
      'Dedicated account manager',
      '99.9% uptime SLA (written)',
      'API access + webhooks',
    ],
    cta: 'Start free trial',
    recommended: false,
  },
];

export default function Pricing() {
  const [yearly, setYearly] = useState(false);

  return (
    <section id="pricing" className="py-20 bg-gray-50/40 border-t border-gray-100">
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55 }}
          className="mb-12"
        >
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 tracking-tight mb-3">
            No per-message fees. No surprises.
          </h2>
          <p className="text-lg text-gray-500 mb-6">Flat monthly pricing. Use as much as you need.</p>

          {/* Toggle */}
          <div className="inline-flex items-center gap-2 p-1 bg-gray-100 rounded-xl">
            <button
              onClick={() => setYearly(false)}
              className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition-all ${!yearly ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Monthly
            </button>
            <button
              onClick={() => setYearly(true)}
              className={`flex items-center gap-2 px-4 py-1.5 text-sm font-semibold rounded-lg transition-all ${yearly ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Yearly
              <span className="text-[10px] px-1.5 py-0.5 bg-[#f0fdf4] text-[#15803d] border border-[#bbf7d0] rounded-full font-bold">
                2 months free
              </span>
            </button>
          </div>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-5">
          {plans.map((plan, i) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.5 }}
              className={`relative flex flex-col rounded-2xl p-6 ${
                plan.recommended
                  ? 'bg-gray-900 text-white border-2 border-gray-900 shadow-xl'
                  : 'bg-white border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all'
              }`}
            >
              {plan.recommended && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#25D366] text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-sm">
                  Most popular
                </div>
              )}

              <div className="mb-5">
                <h3 className={`text-base font-bold mb-1 ${plan.recommended ? 'text-white' : 'text-gray-900'}`}>{plan.name}</h3>
                <p className={`text-xs mb-4 ${plan.recommended ? 'text-gray-400' : 'text-gray-500'}`}>{plan.tagline}</p>
                <div className="flex items-end gap-1">
                  <span className={`text-4xl font-extrabold ${plan.recommended ? 'text-white' : 'text-gray-900'}`}>
                    ${yearly ? Math.floor(plan.monthly * 0.83) : plan.monthly}
                  </span>
                  <span className={`text-sm mb-1 ${plan.recommended ? 'text-gray-400' : 'text-gray-400'}`}>/month</span>
                </div>
                {yearly && <p className="text-xs text-[#25D366] mt-0.5 font-semibold">Billed annually</p>}
              </div>

              <Link
                href="/auth/register"
                className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors mb-6 ${
                  plan.recommended
                    ? 'bg-[#25D366] hover:bg-[#1aad57] text-white'
                    : 'bg-gray-900 hover:bg-gray-800 text-white'
                }`}
              >
                {plan.cta} <ArrowRight size={14} />
              </Link>

              <ul className="space-y-2.5 flex-1">
                {plan.features.map((feat) => (
                  <li key={feat} className="flex items-start gap-2.5">
                    <Check
                      size={14}
                      className={`flex-shrink-0 mt-0.5 ${plan.recommended ? 'text-[#25D366]' : 'text-[#25D366]'}`}
                    />
                    <span className={`text-sm ${plan.recommended ? 'text-gray-300' : 'text-gray-600'}`}>{feat}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4 }}
          className="mt-8 flex flex-wrap justify-center gap-5 text-sm text-gray-400"
        >
          <span>14-day free trial on all plans</span>
          <span>·</span>
          <span>No credit card required to start</span>
          <span>·</span>
          <span>Cancel anytime, no questions</span>
          <span>·</span>
          <span>Need more? <a href="mailto:hello@verzchat.com" className="text-gray-600 hover:text-gray-900 underline underline-offset-2">Talk to us</a></span>
        </motion.div>
      </div>
    </section>
  );
}
