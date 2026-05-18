'use client';
import { useEffect, useRef, useState } from 'react';
import { motion, useInView } from 'framer-motion';

function Counter({ to, suffix = '', prefix = '' }: { to: number; suffix?: string; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true });
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isInView) return;
    const duration = 2000;
    const steps = 60;
    const stepValue = to / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += stepValue;
      if (current >= to) { setCount(to); clearInterval(timer); }
      else setCount(Math.floor(current));
    }, duration / steps);
    return () => clearInterval(timer);
  }, [isInView, to]);

  return (
    <span ref={ref}>
      {prefix}{count >= 1000 ? (count / 1000).toFixed(count % 1000 === 0 ? 0 : 1) + 'K' : count}{suffix}
    </span>
  );
}

const stats = [
  { value: 50, suffix: 'M+', label: 'Messages Delivered', desc: 'Monthly across all channels' },
  { value: 10, suffix: 'K+', label: 'Businesses Trust Us', desc: 'From startups to enterprise' },
  { value: 99.9, suffix: '%', label: 'Uptime SLA', desc: 'Guaranteed availability' },
  { value: 2, suffix: 'M+', label: 'Customers Served', desc: 'End customers reached' },
];

const logos = [
  { name: 'Shopify', letter: 'S', color: 'bg-emerald-600' },
  { name: 'Stripe', letter: 'S', color: 'bg-violet-600' },
  { name: 'Notion', letter: 'N', color: 'bg-slate-600' },
  { name: 'Intercom', letter: 'I', color: 'bg-blue-600' },
  { name: 'HubSpot', letter: 'H', color: 'bg-orange-600' },
  { name: 'Salesforce', letter: 'SF', color: 'bg-sky-600' },
  { name: 'Zendesk', letter: 'Z', color: 'bg-teal-600' },
  { name: 'Slack', letter: 'S', color: 'bg-purple-600' },
];

export default function Trust() {
  return (
    <section className="py-20 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-emerald-950/5 to-transparent" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {/* Logos marquee */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-10"
        >
          <p className="text-sm text-slate-500 font-medium uppercase tracking-widest mb-8">
            Trusted by fast-growing businesses worldwide
          </p>
          <div className="relative overflow-hidden">
            <div className="flex items-center gap-8 animate-[slide_30s_linear_infinite]" style={{ width: 'max-content' }}>
              {[...logos, ...logos].map((logo, i) => (
                <div key={i} className="flex items-center gap-2.5 px-5 py-2.5 bg-white/[0.03] border border-white/[0.06] rounded-xl whitespace-nowrap hover:border-white/[0.12] transition-colors">
                  <div className={`w-6 h-6 rounded-md ${logo.color} flex items-center justify-center text-[9px] font-bold text-white`}>
                    {logo.letter}
                  </div>
                  <span className="text-sm font-medium text-slate-400">{logo.name}</span>
                </div>
              ))}
            </div>
            <div className="absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[#030712] to-transparent z-10 pointer-events-none" />
            <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[#030712] to-transparent z-10 pointer-events-none" />
          </div>
        </motion.div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-16">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="relative group bg-white/[0.03] border border-white/[0.07] rounded-2xl p-6 text-center hover:border-emerald-500/30 hover:bg-emerald-500/[0.04] transition-all duration-300"
            >
              <div className="text-4xl font-extrabold text-white mb-1">
                <Counter to={stat.value} suffix={stat.suffix} />
              </div>
              <p className="text-sm font-semibold text-slate-300 mb-1">{stat.label}</p>
              <p className="text-xs text-slate-500">{stat.desc}</p>
              <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-br from-emerald-500/5 to-teal-500/5 pointer-events-none" />
            </motion.div>
          ))}
        </div>
      </div>

      <style jsx>{`
        @keyframes slide {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </section>
  );
}
