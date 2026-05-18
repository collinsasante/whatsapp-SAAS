'use client';
import { useRef } from 'react';
import { motion } from 'framer-motion';
import { Star, Quote } from 'lucide-react';

const testimonials = [
  {
    name: 'Fatima Al-Rashid',
    role: 'CEO, GulfMart',
    avatar: 'FA',
    color: 'bg-violet-500',
    stars: 5,
    metric: '3× faster response',
    quote: 'VerzChat transformed how we handle customer support. Our response time dropped from 2 hours to under 4 minutes. The AI chatbot handles 70% of inquiries automatically — it\'s like having 10 extra agents.',
  },
  {
    name: 'Marcus Chen',
    role: 'Head of Growth, TechFlow SaaS',
    avatar: 'MC',
    color: 'bg-blue-500',
    stars: 5,
    metric: '68% WhatsApp open rate',
    quote: 'We switched from email campaigns to WhatsApp broadcasts with VerzChat. Our open rates went from 22% to 68% overnight. The ROI on campaigns alone justified the entire platform cost within a month.',
  },
  {
    name: 'Sofia Andrade',
    role: 'Customer Success Lead, Nexora',
    avatar: 'SA',
    color: 'bg-emerald-500',
    stars: 5,
    metric: '4.9★ CSAT score',
    quote: "The team inbox is a game-changer. No more lost messages, no more double-replies. Every agent knows exactly what's happening. Our CSAT jumped from 3.7 to 4.9 in 60 days.",
  },
  {
    name: 'James Okafor',
    role: 'Operations Director, SwiftDeliver',
    avatar: 'JO',
    color: 'bg-orange-500',
    stars: 5,
    metric: '82% automation rate',
    quote: "We process 50,000 customer messages daily. VerzChat's automation handles 82% without human intervention. Order tracking, FAQs, rescheduling — all automated. My team focuses on complex issues only.",
  },
  {
    name: 'Priya Nair',
    role: 'Founder, StyleHive',
    avatar: 'PN',
    color: 'bg-pink-500',
    stars: 5,
    metric: '5× sales conversion',
    quote: 'The chatbot flows for product recommendations are incredible. Customers browse, ask questions, and buy — all within WhatsApp. Our conversion rate quintupled compared to our old email-only strategy.',
  },
  {
    name: 'Lars Holmqvist',
    role: 'CTO, ScandiSupport',
    avatar: 'LH',
    color: 'bg-teal-500',
    stars: 5,
    metric: 'Setup in 30 minutes',
    quote: 'As a CTO, I was skeptical about how fast we could onboard. We were fully live in 30 minutes — WhatsApp connected, chatbots configured, team invited. The API documentation is excellent.',
  },
];

export default function Testimonials() {
  return (
    <section className="py-24 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,rgba(16,185,129,0.05)_0%,transparent_60%)]" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-14"
        >
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-xs font-semibold text-amber-400 mb-4">
            <Star size={11} />
            Customer Stories
          </span>
          <h2 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight mb-4">
            Loved by{' '}
            <span className="bg-gradient-to-r from-amber-400 to-orange-300 bg-clip-text text-transparent">10,000+ businesses</span>
          </h2>
          <p className="text-lg text-slate-400">Real results from real teams across every industry.</p>
        </motion.div>

        {/* Masonry grid */}
        <div className="columns-1 sm:columns-2 lg:columns-3 gap-4 space-y-4">
          {testimonials.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="break-inside-avoid bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5 hover:border-white/[0.15] hover:bg-white/[0.05] transition-all duration-300 group"
            >
              {/* Quote icon */}
              <Quote size={18} className="text-emerald-500/40 mb-3" />

              {/* Stars */}
              <div className="flex items-center gap-1 mb-3">
                {Array.from({ length: t.stars }).map((_, j) => (
                  <Star key={j} size={12} className="text-amber-400 fill-amber-400" />
                ))}
              </div>

              {/* Metric badge */}
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full mb-3">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="text-[10px] font-bold text-emerald-400">{t.metric}</span>
              </div>

              {/* Quote */}
              <p className="text-sm text-slate-400 leading-relaxed mb-4">&ldquo;{t.quote}&rdquo;</p>

              {/* Author */}
              <div className="flex items-center gap-2.5 pt-3 border-t border-white/[0.06]">
                <div className={`w-8 h-8 rounded-full ${t.color} flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0`}>
                  {t.avatar}
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{t.name}</p>
                  <p className="text-xs text-slate-500">{t.role}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Average rating */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-6 mt-12 p-6 bg-white/[0.03] border border-white/[0.07] rounded-2xl"
        >
          <div className="flex items-center gap-3">
            <div className="flex">
              {[1,2,3,4,5].map((i) => <Star key={i} size={20} className="text-amber-400 fill-amber-400" />)}
            </div>
            <span className="text-3xl font-extrabold text-white">4.9</span>
            <span className="text-slate-500 text-sm">/ 5 average</span>
          </div>
          <div className="w-px h-10 bg-white/[0.08] hidden sm:block" />
          <p className="text-slate-400 text-sm">Based on 2,400+ verified reviews across G2, Capterra, and Trustpilot</p>
        </motion.div>
      </div>
    </section>
  );
}
