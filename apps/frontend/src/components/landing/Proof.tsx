'use client';
import { motion } from 'framer-motion';
import { Star } from 'lucide-react';

const testimonials = [
  {
    quote: "Before VerzChat, our team was replying from three different phones. Customers were getting duplicate messages or no reply at all. Now everyone works from one inbox, and our response time went from 4 hours to under 8 minutes.",
    name: 'Fatima Al-Rashid',
    role: 'Operations Manager',
    company: 'GulfMart',
    avatar: 'FA',
    color: 'bg-violet-500',
    metric: '4h → 8min response time',
  },
  {
    quote: "The WhatsApp broadcast feature paid for the subscription in the first week. We sent a campaign to 8,000 customers for a flash sale. 71% read rate, orders came in for two days straight. Email never did that for us.",
    name: 'Marcus Chen',
    role: 'Founder',
    company: 'TechFlow',
    avatar: 'MC',
    color: 'bg-blue-500',
    metric: '71% read rate on first campaign',
  },
  {
    quote: "Setup was genuinely 20 minutes. WhatsApp connected, team invited, first message handled. I've tried Chatwoot and Respond.io — the onboarding alone took days. VerzChat just works.",
    name: 'James Okafor',
    role: 'CEO',
    company: 'SwiftDeliver',
    avatar: 'JO',
    color: 'bg-orange-500',
    metric: 'Live in 20 minutes',
  },
];

export default function Proof() {
  return (
    <section className="py-20 bg-white">
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55 }}
          className="mb-12"
        >
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 tracking-tight mb-3">
            What teams say after switching.
          </h2>
          <p className="text-lg text-gray-500">Not what we say. What they say.</p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-5">
          {testimonials.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.5 }}
              className="flex flex-col bg-gray-50 border border-gray-100 rounded-2xl p-6 hover:border-gray-200 hover:shadow-sm transition-all"
            >
              {/* Stars */}
              <div className="flex gap-0.5 mb-3">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star key={s} size={13} className="text-amber-400 fill-amber-400" />
                ))}
              </div>

              {/* Metric */}
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#f0fdf4] border border-[#bbf7d0] rounded-full mb-4 w-fit">
                <div className="w-1.5 h-1.5 rounded-full bg-[#25D366]" />
                <span className="text-[11px] font-bold text-[#15803d]">{t.metric}</span>
              </div>

              <p className="text-sm text-gray-600 leading-relaxed flex-1 mb-5">&ldquo;{t.quote}&rdquo;</p>

              <div className="flex items-center gap-2.5 pt-4 border-t border-gray-200">
                <div className={`w-8 h-8 rounded-full ${t.color} flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0`}>
                  {t.avatar}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{t.name}</p>
                  <p className="text-xs text-gray-400">{t.role}, {t.company}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
