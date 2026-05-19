'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, ArrowRight, Zap } from 'lucide-react';
import Link from 'next/link';

const features = [
  '5 WhatsApp channels',
  '20 team members',
  '20,000 contacts',
  'Unlimited messages',
  'Broadcast campaigns',
  'Chatbot automation',
  'Verz AI assistant',
  'Knowledge base',
  'Analytics dashboard',
  'API access + webhooks',
  'Team inbox with assignments',
  '7-day trial included',
];

export default function Pricing() {
  const [yearly, setYearly] = useState(false);

  const ghsMonthly = yearly ? Math.round(1500 / 12) : 150;
  const usdMonthly = yearly ? 10 : 12;

  return (
    <section id="pricing" className="py-20 bg-gray-50/40 border-t border-gray-100">
      <div className="max-w-3xl mx-auto px-5 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55 }}
          className="text-center mb-10"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#f0fdf4] border border-[#bbf7d0] text-[#15803d] text-xs font-semibold mb-5">
            <Zap size={11} className="fill-[#15803d]" />
            One plan. Everything included.
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 tracking-tight mb-3">
            Simple, honest pricing.
          </h2>
          <p className="text-lg text-gray-500 mb-6">
            No per-message fees. No surprise seat charges. Just one flat price that covers your whole team.
          </p>

          <div className="inline-flex items-center gap-1 p-1 bg-gray-100 rounded-xl">
            <button onClick={() => setYearly(false)}
              className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition-all ${!yearly ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              Monthly
            </button>
            <button onClick={() => setYearly(true)}
              className={`flex items-center gap-2 px-4 py-1.5 text-sm font-semibold rounded-lg transition-all ${yearly ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              Yearly
              <span className="text-[10px] px-1.5 py-0.5 bg-[#f0fdf4] text-[#15803d] border border-[#bbf7d0] rounded-full font-bold">
                2 months free
              </span>
            </button>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55, delay: 0.1 }}
          className="relative bg-gray-900 rounded-3xl p-8 sm:p-10 overflow-hidden"
        >
          <motion.div
            animate={{ opacity: [0.15, 0.3, 0.15] }}
            transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
            className="absolute top-0 left-1/2 -translate-x-1/2 w-80 h-40 bg-[#25D366]/20 rounded-full blur-3xl pointer-events-none"
          />

          <div className="relative flex flex-col sm:flex-row gap-6 items-start sm:items-center mb-8">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-[11px] font-bold px-3 py-1 rounded-full bg-[#25D366]/20 text-[#4ade80] border border-[#25D366]/30 uppercase tracking-wide">Pro</span>
                <span className="text-sm text-gray-500">Everything you need, nothing you don't</span>
              </div>
              <div className="flex items-end gap-3 mb-1.5">
                <motion.span
                  key={ghsMonthly}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-5xl font-extrabold text-white"
                >
                  GH₵{ghsMonthly}
                </motion.span>
                <span className="text-gray-400 text-base mb-1.5">/month</span>
                <span className="text-gray-500 text-sm mb-1.5">·</span>
                <span className="text-gray-400 text-sm mb-1.5">~${usdMonthly} USD</span>
              </div>
              {yearly && (
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[#4ade80] text-sm font-semibold">
                  Billed GH₵1,500/year — you save GH₵300
                </motion.p>
              )}
              <p className="text-gray-500 text-sm mt-1">7-day trial, no card required to start.</p>
            </div>
            <div className="flex-shrink-0 w-full sm:w-auto">
              <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
                <Link href="/auth/register"
                  className="flex items-center justify-center gap-2 px-8 py-3.5 bg-[#25D366] hover:bg-[#1aad57] text-white font-semibold rounded-xl transition-colors shadow-lg text-sm w-full sm:w-auto">
                  Get started <ArrowRight size={15} />
                </Link>
              </motion.div>
              <p className="text-[11px] text-gray-600 text-center mt-2">Cancel any time, no catch</p>
            </div>
          </div>

          <div className="relative border-t border-white/[0.08] pt-7">
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3">
              {features.map((feat, i) => (
                <motion.div key={feat} initial={{ opacity: 0, x: -8 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
                  transition={{ delay: i * 0.04, duration: 0.35 }}
                  className="flex items-center gap-2.5">
                  <Check size={14} className="text-[#25D366] flex-shrink-0" />
                  <span className="text-sm text-gray-300">{feat}</span>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>

        <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.4 }}
          className="mt-6 text-center text-sm text-gray-400">
          Need more channels, more agents, or a custom setup?{' '}
          <a href="mailto:notifications@verzchat.com" className="text-gray-600 hover:text-gray-900 underline underline-offset-2 transition-colors">
            Let's figure it out together.
          </a>
        </motion.p>
      </div>
    </section>
  );
}
