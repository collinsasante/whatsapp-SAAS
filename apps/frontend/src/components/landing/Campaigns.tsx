'use client';
import { motion } from 'framer-motion';
import { Megaphone, Send, Eye, MousePointerClick, TrendingUp, Users, BarChart3 } from 'lucide-react';

export default function Campaigns() {
  const campaignData = [
    { name: 'Summer Sale 2024', sent: 12450, delivered: '98.2%', read: '67.4%', clicked: '12.1%', status: 'Completed', color: 'bg-emerald-500' },
    { name: 'Product Launch', sent: 8320, delivered: '99.1%', read: '71.3%', clicked: '18.6%', status: 'Active', color: 'bg-blue-500' },
    { name: 'Re-engagement', sent: 4180, delivered: '96.8%', read: '43.2%', clicked: '8.4%', status: 'Scheduled', color: 'bg-orange-500' },
  ];

  return (
    <section className="py-24 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(249,115,22,0.06)_0%,transparent_60%)]" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-xs font-semibold text-orange-400 mb-4">
            <Megaphone size={11} />
            Broadcast Campaigns
          </span>
          <h2 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight mb-4">
            Reach thousands,{' '}
            <span className="bg-gradient-to-r from-orange-400 to-amber-300 bg-clip-text text-transparent">instantly</span>
          </h2>
          <p className="text-lg text-slate-400 max-w-xl mx-auto">
            Send personalized WhatsApp campaigns to segmented audiences. Rich media, buttons, and real-time analytics included.
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-5 gap-6">
          {/* Campaign table */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="lg:col-span-3 bg-white/[0.03] border border-white/[0.07] rounded-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
              <div className="flex items-center gap-2">
                <Megaphone size={15} className="text-orange-400" />
                <span className="text-sm font-semibold text-white">Campaign Performance</span>
              </div>
              <button className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/20 transition-colors">
                <Send size={11} /> New Campaign
              </button>
            </div>

            <div className="px-5 py-2">
              <div className="grid grid-cols-5 text-[10px] text-slate-600 font-semibold uppercase tracking-wider py-2 border-b border-white/[0.04]">
                <span className="col-span-2">Campaign</span>
                <span className="text-center">Delivered</span>
                <span className="text-center">Read</span>
                <span className="text-center">Clicked</span>
              </div>
              {campaignData.map((c, i) => (
                <motion.div
                  key={c.name}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="grid grid-cols-5 items-center py-3 border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors"
                >
                  <div className="col-span-2 flex items-center gap-2.5">
                    <div className={`w-7 h-7 rounded-lg ${c.color}/20 border border-current/20 flex items-center justify-center`}>
                      <Megaphone size={11} className={c.color.replace('bg-', 'text-')} />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-white">{c.name}</p>
                      <p className="text-[9px] text-slate-500">{c.sent.toLocaleString()} sent</p>
                    </div>
                  </div>
                  <div className="text-center">
                    <span className="text-xs font-bold text-emerald-400">{c.delivered}</span>
                  </div>
                  <div className="text-center">
                    <span className="text-xs font-bold text-blue-400">{c.read}</span>
                  </div>
                  <div className="text-center">
                    <span className="text-xs font-bold text-orange-400">{c.clicked}</span>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Message preview */}
            <div className="px-5 py-4 border-t border-white/[0.07]">
              <p className="text-[10px] text-slate-500 mb-2 font-medium uppercase tracking-wider">Message Preview</p>
              <div className="bg-[#128C7E]/10 border border-[#25D366]/20 rounded-xl p-3 max-w-xs">
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="w-4 h-4 rounded-full bg-[#25D366] flex items-center justify-center">
                    <span className="text-[8px] font-bold text-white">V</span>
                  </div>
                  <span className="text-[9px] text-[#25D366] font-semibold">VerzChat Business</span>
                </div>
                <p className="text-[10px] text-white leading-relaxed">Hey Sarah! 🎉 Our Summer Sale is live — up to 50% off. Click below to shop now!</p>
                <div className="mt-2 p-2 bg-[#25D366]/20 rounded-lg border border-[#25D366]/30 text-center cursor-pointer hover:bg-[#25D366]/30 transition-colors">
                  <p className="text-[9px] font-bold text-[#25D366]">🛍️ Shop Now</p>
                </div>
                <div className="flex items-center justify-end gap-1 mt-1.5">
                  <span className="text-[8px] text-slate-500">14:32</span>
                  <svg width="12" height="8" viewBox="0 0 12 8">
                    <path d="M1 4L3.5 6.5L7 2" stroke="#34d399" strokeWidth="1.2" strokeLinecap="round"/>
                    <path d="M5 4L7.5 6.5L11 2" stroke="#34d399" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Right stats */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="lg:col-span-2 flex flex-col gap-4"
          >
            {[
              { icon: Send, label: 'Total Sent', value: '2.4M', sub: 'This month', color: 'from-orange-500/20 to-amber-500/10', iconColor: 'text-orange-400', border: 'border-orange-500/20' },
              { icon: Eye, label: 'Avg Read Rate', value: '67.4%', sub: '↑ 8% vs last month', color: 'from-blue-500/20 to-cyan-500/10', iconColor: 'text-blue-400', border: 'border-blue-500/20' },
              { icon: MousePointerClick, label: 'Avg CTR', value: '12.1%', sub: 'Industry avg: 3.2%', color: 'from-violet-500/20 to-purple-500/10', iconColor: 'text-violet-400', border: 'border-violet-500/20' },
              { icon: Users, label: 'Contacts Reached', value: '48.2K', sub: 'Unique this month', color: 'from-emerald-500/20 to-teal-500/10', iconColor: 'text-emerald-400', border: 'border-emerald-500/20' },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 + i * 0.1 }}
                className={`flex items-center gap-3 p-4 bg-gradient-to-r ${stat.color} border ${stat.border} rounded-xl hover:scale-[1.02] transition-transform cursor-pointer`}
              >
                <div className={`w-9 h-9 rounded-xl bg-black/20 flex items-center justify-center flex-shrink-0`}>
                  <stat.icon size={16} className={stat.iconColor} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-400">{stat.label}</p>
                  <p className="text-xl font-bold text-white">{stat.value}</p>
                  <p className="text-[10px] text-slate-500">{stat.sub}</p>
                </div>
              </motion.div>
            ))}

            {/* Chart */}
            <div className="p-4 bg-white/[0.03] border border-white/[0.07] rounded-xl">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 size={13} className="text-orange-400" />
                <p className="text-xs font-semibold text-slate-400">Delivery trend (7d)</p>
              </div>
              <div className="flex items-end gap-1 h-12">
                {[65, 72, 68, 80, 76, 88, 98].map((h, i) => (
                  <motion.div
                    key={i}
                    initial={{ height: 0 }}
                    whileInView={{ height: `${h}%` }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.05, duration: 0.5 }}
                    className="flex-1 bg-gradient-to-t from-orange-500/60 to-orange-500/20 rounded-sm"
                  />
                ))}
              </div>
              <div className="flex justify-between mt-1">
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                  <span key={i} className="text-[8px] text-slate-600 flex-1 text-center">{d}</span>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
