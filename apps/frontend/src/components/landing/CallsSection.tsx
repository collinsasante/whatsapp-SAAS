'use client';
import { motion } from 'framer-motion';
import { PhoneCall, PhoneIncoming, PhoneMissed, Mic, MicOff, Video, Clock, BarChart3 } from 'lucide-react';

export default function CallsSection() {
  return (
    <section className="py-24 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(236,72,153,0.06)_0%,transparent_60%)]" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left text */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
          >
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-pink-500/10 border border-pink-500/20 text-xs font-semibold text-pink-400 mb-4">
              <PhoneCall size={11} />
              Voice & Video Calls
            </span>
            <h2 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight mb-5 leading-tight">
              Talk to customers,{' '}
              <span className="bg-gradient-to-r from-pink-400 to-rose-300 bg-clip-text text-transparent">not just chat</span>
            </h2>
            <p className="text-lg text-slate-400 leading-relaxed mb-8">
              In-app voice and video calls with auto-recordings, AI transcriptions, and full analytics. Every call logged, searchable, and actionable.
            </p>

            <div className="space-y-3 mb-8">
              {[
                { icon: PhoneCall, label: 'HD Voice & Video', desc: 'Crystal-clear calls powered by WebRTC — no extra apps needed.', color: 'text-pink-400 bg-pink-500/10 border-pink-500/20' },
                { icon: Mic, label: 'Auto Recordings', desc: 'Every call recorded automatically with consent notices. Replay anytime.', color: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
                { icon: BarChart3, label: 'Call Analytics', desc: 'Average duration, wait time, missed rate, and agent performance dashboards.', color: 'text-orange-400 bg-orange-500/10 border-orange-500/20' },
              ].map((item) => (
                <div key={item.label} className="flex items-start gap-3 p-3.5 bg-white/[0.03] border border-white/[0.07] rounded-xl hover:border-pink-500/25 transition-colors">
                  <div className={`w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0 ${item.color}`}>
                    <item.icon size={14} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{item.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Call stats */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { value: '4.8min', label: 'Avg Duration', color: 'text-pink-400' },
                { value: '92%', label: 'Answer Rate', color: 'text-emerald-400' },
                { value: '1.2min', label: 'Wait Time', color: 'text-blue-400' },
              ].map((s) => (
                <div key={s.label} className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-3 text-center">
                  <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Right — calls UI mockup */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="relative"
          >
            <div className="bg-[#0a0f1a] border border-white/[0.08] rounded-2xl overflow-hidden shadow-2xl">
              {/* Header */}
              <div className="px-4 py-3 border-b border-white/[0.06] bg-[#0d1117] flex items-center justify-between">
                <span className="text-xs font-semibold text-white">Calls</span>
                <div className="flex gap-1">
                  {['All', 'Active', 'Missed'].map((t, i) => (
                    <button key={t} className={`text-[9px] px-2 py-1 rounded-lg font-medium ${i === 0 ? 'bg-white/[0.08] text-white' : 'text-slate-500 hover:text-slate-300'}`}>{t}</button>
                  ))}
                </div>
              </div>

              {/* Active call bar */}
              <div className="mx-4 mt-4 mb-3 p-3 bg-emerald-500/10 border border-emerald-500/25 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-violet-500 flex items-center justify-center text-sm font-bold text-white">S</div>
                    <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#0a0f1a] animate-pulse" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-white">Sarah Johnson</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-[10px] text-red-400 font-semibold">LIVE</span>
                      <span className="text-[10px] text-slate-400">· 4:21</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Waveform */}
                    <div className="flex items-end gap-0.5 h-6">
                      {[3, 5, 4, 7, 5, 8, 4, 6, 7, 5].map((h, i) => (
                        <motion.div
                          key={i}
                          className="w-1 bg-emerald-400 rounded-full"
                          animate={{ height: [`${h * 2}px`, `${h * 3.5}px`, `${h * 2}px`] }}
                          transition={{ duration: 0.5 + i * 0.1, repeat: Infinity, ease: 'easeInOut' }}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button className="w-8 h-8 rounded-full bg-white/[0.07] flex items-center justify-center hover:bg-white/[0.12] transition-colors">
                        <Mic size={13} className="text-emerald-400" />
                      </button>
                      <button className="w-8 h-8 rounded-full bg-white/[0.07] flex items-center justify-center hover:bg-white/[0.12] transition-colors">
                        <Video size={13} className="text-slate-400" />
                      </button>
                      <button className="w-8 h-8 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center hover:bg-red-500/30 transition-colors">
                        <PhoneCall size={12} className="text-red-400 rotate-[135deg]" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Call list */}
              <div className="px-4 pb-4 space-y-2">
                {[
                  { name: 'Ahmed Al-Farsi', time: '09:14 AM', duration: '8:32', type: 'inbound', status: 'completed' },
                  { name: 'Tech Corp', time: '08:47 AM', duration: '—', type: 'missed', status: 'missed' },
                  { name: 'Maria Santos', time: '08:12 AM', duration: '3:15', type: 'outbound', status: 'completed' },
                  { name: 'Dev Team', time: 'Yesterday', duration: '12:04', type: 'inbound', status: 'completed' },
                ].map((call, i) => (
                  <motion.div
                    key={call.name}
                    initial={{ opacity: 0, y: 10 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.08 }}
                    className="flex items-center gap-3 p-2.5 bg-white/[0.02] rounded-xl hover:bg-white/[0.04] transition-colors border border-white/[0.04] cursor-pointer"
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${call.status === 'missed' ? 'bg-red-500/20' : 'bg-emerald-500/20'}`}>
                      {call.status === 'missed'
                        ? <PhoneMissed size={13} className="text-red-400" />
                        : call.type === 'inbound'
                          ? <PhoneIncoming size={13} className="text-emerald-400" />
                          : <PhoneCall size={13} className="text-blue-400" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[11px] font-semibold ${call.status === 'missed' ? 'text-red-300' : 'text-white'}`}>{call.name}</p>
                      <div className="flex items-center gap-1.5">
                        <Clock size={8} className="text-slate-600" />
                        <span className="text-[9px] text-slate-500">{call.time}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-medium ${call.status === 'missed' ? 'text-red-400' : 'text-slate-400'}`}>{call.duration}</span>
                      {call.status === 'completed' && (
                        <div className="w-5 h-5 rounded-full bg-white/[0.06] flex items-center justify-center">
                          <Mic size={9} className="text-slate-500" />
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>

            <div className="absolute -bottom-4 -right-4 w-48 bg-[#0d1117]/90 backdrop-blur-xl border border-pink-500/20 rounded-xl p-3 shadow-2xl animate-float-delay">
              <p className="text-[10px] font-bold text-white mb-2">Today's Call Summary</p>
              <div className="space-y-1">
                {[['Total Calls', '28'], ['Avg Duration', '4m 18s'], ['Missed', '3 (10.7%)']].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-[9px]">
                    <span className="text-slate-500">{k}</span>
                    <span className="text-white font-medium">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
