'use client';
import { motion } from 'framer-motion';
import { ArrowRight, MessageSquare, Zap } from 'lucide-react';
import Link from 'next/link';

export default function FinalCTA() {
  return (
    <section className="py-24 relative overflow-hidden">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="relative text-center"
        >
          {/* Glow bg */}
          <div className="absolute inset-0 -z-10">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(16,185,129,0.18)_0%,transparent_70%)] rounded-3xl" />
            <div className="absolute inset-0 bg-gradient-to-r from-emerald-950/40 via-[#030712] to-teal-950/40 rounded-3xl" />
          </div>

          {/* Animated border card */}
          <div className="relative bg-white/[0.03] border border-emerald-500/25 rounded-3xl px-8 py-16 sm:py-20 overflow-hidden shadow-[0_0_80px_rgba(16,185,129,0.12)]">
            {/* Corner accents */}
            <div className="absolute top-0 left-0 w-32 h-32 border-t-2 border-l-2 border-emerald-500/30 rounded-tl-3xl" />
            <div className="absolute top-0 right-0 w-32 h-32 border-t-2 border-r-2 border-emerald-500/30 rounded-tr-3xl" />
            <div className="absolute bottom-0 left-0 w-32 h-32 border-b-2 border-l-2 border-teal-500/20 rounded-bl-3xl" />
            <div className="absolute bottom-0 right-0 w-32 h-32 border-b-2 border-r-2 border-teal-500/20 rounded-br-3xl" />

            {/* Floating dots */}
            {[['-top-8', 'left-1/4', '2.5s'], ['-bottom-6', 'right-1/3', '3.5s'], ['top-1/3', '-left-6', '4s']].map(([t, l, d], i) => (
              <div
                key={i}
                className="absolute w-3 h-3 rounded-full bg-emerald-400/30 border border-emerald-400/50 animate-float"
                style={{ top: t.startsWith('-') ? undefined : t, bottom: t.startsWith('-') ? t.slice(1) : undefined, left: l, animationDelay: d }}
              />
            ))}

            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/25 rounded-full text-sm font-semibold text-emerald-400 mb-6"
            >
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Start in under 10 minutes
            </motion.div>

            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white tracking-tight mb-5 leading-tight">
              Ready to scale{' '}
              <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
                customer conversations?
              </span>
            </h2>

            <p className="text-lg text-slate-400 max-w-xl mx-auto mb-10">
              Join 10,000+ businesses that use VerzChat to deliver exceptional customer experiences at scale. 14-day free trial, no credit card required.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-10">
              <Link
                href="/auth/register"
                className="flex items-center gap-2.5 px-7 py-4 bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold rounded-xl hover:shadow-[0_0_40px_rgba(16,185,129,0.6)] transition-all duration-300 hover:scale-[1.03] text-base"
              >
                <Zap size={16} />
                Start Free Trial
                <ArrowRight size={16} />
              </Link>
              <Link
                href="#"
                className="flex items-center gap-2.5 px-7 py-4 bg-white/[0.06] border border-white/[0.12] text-white font-bold rounded-xl hover:bg-white/[0.10] transition-all duration-200 text-base"
              >
                <MessageSquare size={16} />
                Talk to Sales
              </Link>
            </div>

            {/* Social proof */}
            <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-slate-500">
              {['✓ No credit card required', '✓ 14-day free trial', '✓ Cancel anytime', '✓ 99.9% uptime SLA'].map((item) => (
                <span key={item} className="hover:text-slate-300 transition-colors">{item}</span>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
