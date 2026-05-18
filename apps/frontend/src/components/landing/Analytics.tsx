'use client';
import { motion } from 'framer-motion';
import { BarChart3, TrendingUp, Clock, Star, Zap, Users } from 'lucide-react';

const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const conversationData = [42, 68, 55, 88, 74, 95, 82];
const responseData = [38, 60, 48, 75, 66, 84, 70];

export default function Analytics() {
  return (
    <section className="py-24 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,0.06)_0%,transparent_70%)]" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-xs font-semibold text-indigo-400 mb-4">
            <BarChart3 size={11} />
            Analytics & Insights
          </span>
          <h2 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight mb-4">
            Data-driven decisions,{' '}
            <span className="bg-gradient-to-r from-indigo-400 to-blue-300 bg-clip-text text-transparent">every day</span>
          </h2>
          <p className="text-lg text-slate-400 max-w-xl mx-auto">
            Real-time dashboards with every metric that matters. From CSAT to agent productivity, know exactly what's happening.
          </p>
        </motion.div>

        {/* Main dashboard mockup */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
          className="bg-[#0a0f1a] border border-white/[0.08] rounded-2xl overflow-hidden shadow-2xl"
        >
          {/* Top bar */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06] bg-[#0d1117]">
            <div className="flex items-center gap-2">
              <BarChart3 size={14} className="text-indigo-400" />
              <span className="text-sm font-semibold text-white">Analytics Overview</span>
            </div>
            <div className="flex items-center gap-2">
              {['7d', '30d', '90d', 'Custom'].map((p, i) => (
                <button key={p} className={`text-[10px] px-2.5 py-1 rounded-lg font-medium ${i === 1 ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'text-slate-500 hover:text-slate-300'}`}>{p}</button>
              ))}
            </div>
          </div>

          {/* KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-white/[0.05] border-b border-white/[0.06]">
            {[
              { icon: BarChart3, label: 'Conversations', value: '12,847', change: '+18%', color: 'text-indigo-400', positive: true },
              { icon: Clock, label: 'Avg Response', value: '1m 24s', change: '-12%', color: 'text-blue-400', positive: true },
              { icon: Star, label: 'CSAT Score', value: '4.8 / 5', change: '+0.3', color: 'text-amber-400', positive: true },
              { icon: Users, label: 'Active Agents', value: '24', change: '+3', color: 'text-emerald-400', positive: true },
              { icon: Zap, label: 'AI Resolved', value: '68%', change: '+11%', color: 'text-violet-400', positive: true },
              { icon: TrendingUp, label: 'Resolution Rate', value: '94.2%', change: '+2%', color: 'text-teal-400', positive: true },
            ].map((kpi, i) => (
              <motion.div
                key={kpi.label}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
                className="p-4 hover:bg-white/[0.02] transition-colors"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <kpi.icon size={11} className={kpi.color} />
                  <span className="text-[9px] text-slate-500 uppercase tracking-wider">{kpi.label}</span>
                </div>
                <p className="text-lg font-bold text-white">{kpi.value}</p>
                <p className={`text-[10px] font-semibold ${kpi.positive ? 'text-emerald-400' : 'text-red-400'}`}>{kpi.change}</p>
              </motion.div>
            ))}
          </div>

          {/* Charts row */}
          <div className="grid lg:grid-cols-3 divide-x divide-white/[0.05] p-5 gap-5">
            {/* Conversation volume chart */}
            <div className="lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-semibold text-slate-300">Conversation Volume (7d)</p>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-indigo-500" /><span className="text-[10px] text-slate-500">Conversations</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-emerald-500" /><span className="text-[10px] text-slate-500">Resolved</span></div>
                </div>
              </div>
              <div className="relative h-40">
                <svg className="w-full h-full" viewBox="0 0 420 120" preserveAspectRatio="none">
                  {/* Grid lines */}
                  {[0, 30, 60, 90, 120].map((y) => (
                    <line key={y} x1="0" y1={y} x2="420" y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
                  ))}
                  {/* Conversation area */}
                  <motion.path
                    d={`M 0 ${120 - conversationData[0] * 1.2} ${conversationData.map((v, i) => `L ${i * 70} ${120 - v * 1.2}`).join(' ')} L 420 120 L 0 120 Z`}
                    fill="url(#indigo-grad)"
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.8 }}
                  />
                  <motion.path
                    d={`M 0 ${120 - conversationData[0] * 1.2} ${conversationData.map((v, i) => `L ${i * 70} ${120 - v * 1.2}`).join(' ')}`}
                    fill="none"
                    stroke="#6366f1"
                    strokeWidth="2"
                    initial={{ pathLength: 0 }}
                    whileInView={{ pathLength: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 1 }}
                  />
                  {/* Response area */}
                  <motion.path
                    d={`M 0 ${120 - responseData[0] * 1.2} ${responseData.map((v, i) => `L ${i * 70} ${120 - v * 1.2}`).join(' ')} L 420 120 L 0 120 Z`}
                    fill="url(#emerald-grad)"
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.8, delay: 0.2 }}
                  />
                  <motion.path
                    d={`M 0 ${120 - responseData[0] * 1.2} ${responseData.map((v, i) => `L ${i * 70} ${120 - v * 1.2}`).join(' ')}`}
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="2"
                    initial={{ pathLength: 0 }}
                    whileInView={{ pathLength: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 1, delay: 0.2 }}
                  />
                  <defs>
                    <linearGradient id="indigo-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity="0.02" />
                    </linearGradient>
                    <linearGradient id="emerald-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity="0.2" />
                      <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="flex justify-between mt-1">
                  {weekDays.map((d) => (
                    <span key={d} className="text-[9px] text-slate-600 flex-1 text-center">{d}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* Agent performance */}
            <div>
              <p className="text-xs font-semibold text-slate-300 mb-4">Top Agents (30d)</p>
              <div className="space-y-2.5">
                {[
                  { name: 'Alice M.', resolved: 342, csat: 4.9, color: 'bg-violet-500' },
                  { name: 'Bob K.', resolved: 298, csat: 4.7, color: 'bg-blue-500' },
                  { name: 'Carol T.', resolved: 276, csat: 4.8, color: 'bg-emerald-500' },
                  { name: 'Dan R.', resolved: 241, csat: 4.6, color: 'bg-orange-500' },
                ].map((agent, i) => (
                  <div key={agent.name} className="flex items-center gap-2.5">
                    <div className={`w-6 h-6 rounded-full ${agent.color} flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0`}>
                      {agent.name[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center mb-0.5">
                        <span className="text-[10px] font-semibold text-slate-300">{agent.name}</span>
                        <span className="text-[9px] text-slate-500">{agent.resolved}</span>
                      </div>
                      <div className="h-1 bg-white/[0.06] rounded-full">
                        <motion.div
                          initial={{ width: 0 }}
                          whileInView={{ width: `${(agent.resolved / 342) * 100}%` }}
                          viewport={{ once: true }}
                          transition={{ delay: i * 0.1, duration: 0.6 }}
                          className={`h-full ${agent.color} rounded-full opacity-70`}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5">
                      <Star size={9} className="text-amber-400" />
                      <span className="text-[9px] text-amber-400 font-medium">{agent.csat}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
