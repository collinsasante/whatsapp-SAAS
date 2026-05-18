'use client';
import { motion } from 'framer-motion';
import { MessageSquare, Mail, Globe } from 'lucide-react';

const channels = [
  { name: 'WhatsApp', color: '#25D366', bg: 'bg-[#25D366]', ring: 'ring-[#25D366]/30', icon: '💬', desc: '2B+ users' },
  { name: 'Instagram', color: '#E1306C', bg: 'bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400', ring: 'ring-pink-500/30', icon: '📸', desc: '2B+ users' },
  { name: 'Facebook', color: '#1877F2', bg: 'bg-[#1877F2]', ring: 'ring-blue-500/30', icon: 'f', desc: '3B+ users' },
  { name: 'Telegram', color: '#26A5E4', bg: 'bg-[#26A5E4]', ring: 'ring-sky-400/30', icon: '✈️', desc: '800M+ users' },
  { name: 'Email', color: '#f97316', bg: 'bg-orange-500', ring: 'ring-orange-500/30', icon: '✉️', desc: 'Universal' },
  { name: 'Live Chat', color: '#10b981', bg: 'bg-emerald-500', ring: 'ring-emerald-500/30', icon: '💭', desc: 'Web & Mobile' },
  { name: 'LINE', color: '#06C755', bg: 'bg-[#06C755]', ring: 'ring-green-500/30', icon: 'L', desc: '95M+ users' },
  { name: 'TikTok', color: '#010101', bg: 'bg-slate-800', ring: 'ring-slate-500/30', icon: '♪', desc: '1B+ users' },
];

export default function Omnichannel() {
  return (
    <section id="omnichannel" className="py-24 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(16,185,129,0.06)_0%,transparent_70%)]" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
          >
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-xs font-semibold text-blue-400 mb-4">
              <Globe size={11} />
              Omnichannel
            </span>
            <h2 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight mb-5 leading-tight">
              One inbox for every{' '}
              <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">customer conversation</span>
            </h2>
            <p className="text-lg text-slate-400 leading-relaxed mb-8">
              Stop switching between apps. Connect all your messaging channels and manage every conversation from a single, unified workspace your team will love.
            </p>

            <div className="space-y-3">
              {[
                { icon: MessageSquare, title: 'Unified thread history', desc: 'All customer touchpoints in one timeline, regardless of channel.' },
                { icon: Mail, title: 'Cross-channel continuity', desc: "Switch channels mid-conversation without losing context or history." },
                { icon: Globe, title: 'Smart routing', desc: 'Route incoming messages to the right team based on channel, keyword, or time.' },
              ].map((item) => (
                <div key={item.title} className="flex items-start gap-3 p-3.5 bg-white/[0.03] border border-white/[0.07] rounded-xl hover:border-blue-500/30 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                    <item.icon size={14} className="text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{item.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Right — Channel grid */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="relative"
          >
            {/* Center hub */}
            <div className="relative flex items-center justify-center" style={{ height: 420 }}>
              {/* Rings */}
              <div className="absolute w-72 h-72 rounded-full border border-white/[0.04]" />
              <div className="absolute w-52 h-52 rounded-full border border-white/[0.06]" />
              <div className="absolute w-32 h-32 rounded-full border border-emerald-500/10" />

              {/* Center */}
              <div className="relative z-10 w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-[0_0_40px_rgba(16,185,129,0.5)]">
                <MessageSquare size={24} className="text-white" />
              </div>

              {/* Channel cards orbiting */}
              {channels.map((ch, i) => {
                const angle = (i / channels.length) * 2 * Math.PI;
                const radius = 155;
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;
                return (
                  <motion.div
                    key={ch.name}
                    initial={{ opacity: 0, scale: 0.5 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.08, duration: 0.4 }}
                    whileHover={{ scale: 1.15 }}
                    className="absolute cursor-pointer"
                    style={{ left: `calc(50% + ${x}px - 28px)`, top: `calc(50% + ${y}px - 28px)` }}
                  >
                    <div className={`group relative w-14 h-14 rounded-2xl ${ch.bg.startsWith('bg-gradient') ? '' : ch.bg} ${ch.bg.startsWith('bg-gradient') ? ch.bg : ''} flex items-center justify-center shadow-lg ring-2 ring-transparent hover:${ch.ring} transition-all`}>
                      <span className="text-xl">{typeof ch.icon === 'string' && ch.icon.length > 1 ? ch.icon : ch.icon}</span>
                      {/* Tooltip */}
                      <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-[#0d1117] border border-white/10 rounded-lg px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-20">
                        <p className="text-[9px] font-semibold text-white">{ch.name}</p>
                        <p className="text-[8px] text-slate-500">{ch.desc}</p>
                      </div>
                      {/* SVG line to center */}
                    </div>
                  </motion.div>
                );
              })}

              {/* SVG lines from center to channels */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }}>
                {channels.map((ch, i) => {
                  const angle = (i / channels.length) * 2 * Math.PI;
                  const radius = 155;
                  const x = Math.cos(angle) * radius + 210;
                  const y = Math.sin(angle) * radius + 210;
                  return (
                    <motion.line
                      key={ch.name}
                      x1="210" y1="210" x2={x} y2={y}
                      stroke="rgba(255,255,255,0.06)"
                      strokeWidth="1"
                      strokeDasharray="4 4"
                      initial={{ pathLength: 0, opacity: 0 }}
                      whileInView={{ pathLength: 1, opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.1, duration: 0.8 }}
                    />
                  );
                })}
              </svg>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
