'use client';
import { motion } from 'framer-motion';
import { ArrowRight, Zap, TrendingUp, MessageSquare, Check } from 'lucide-react';
import Link from 'next/link';

function FloatCard({ delay, children, className }: { delay: number; children: React.ReactNode; className: string }) {
  return (
    <motion.div
      animate={{ y: [0, -12, 0] }}
      transition={{ duration: 6, delay, repeat: Infinity, ease: 'easeInOut' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function InboxMockup() {
  const convos = [
    { name: 'Sarah Johnson', msg: 'Hi, I need help with my order...', time: '2m', unread: 3, status: 'online', color: 'bg-violet-500' },
    { name: 'Tech Corp', msg: 'Can we schedule a demo?', time: '5m', unread: 1, status: 'away', color: 'bg-blue-500' },
    { name: 'Ahmed Al-Farsi', msg: 'Perfect, thank you! 👍', time: '12m', unread: 0, status: 'online', color: 'bg-emerald-500' },
    { name: 'Maria Santos', msg: 'When will my package arrive?', time: '1h', unread: 2, status: 'offline', color: 'bg-orange-500' },
    { name: 'Dev Team', msg: 'API integration complete ✅', time: '2h', unread: 0, status: 'online', color: 'bg-pink-500' },
  ];

  const messages = [
    { text: "Hi! I need help with my order #4821. It hasn't arrived yet.", from: 'them', time: '14:32' },
    { text: "Hi Sarah! Let me check that for you right away 🔍", from: 'me', time: '14:33' },
    { text: "I can see your order is currently in transit and expected by tomorrow. Want me to send you the tracking link?", from: 'me', time: '14:33' },
    { text: "Yes please! That would be great 😊", from: 'them', time: '14:34' },
    { text: "Done! I've sent the tracking link to your WhatsApp. Anything else I can help with?", from: 'me', time: '14:34' },
  ];

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden bg-[#0a0f1a] border border-white/[0.08] shadow-2xl">
      {/* Top bar */}
      <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-white/[0.06] bg-[#0d1117]">
        <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
        <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
        <span className="text-[10px] text-slate-500 ml-2 font-medium">VerzChat — Inbox</span>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-emerald-400 font-medium">Live</span>
        </div>
      </div>

      <div className="flex h-[calc(100%-36px)]">
        {/* Sidebar */}
        <div className="w-[38%] border-r border-white/[0.06] flex flex-col bg-[#090e18]">
          <div className="px-2.5 py-2">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-white/[0.05] rounded-lg border border-white/[0.06]">
              <div className="w-3 h-3 text-slate-500">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="6" r="4"/><path d="M11 11l2 2"/></svg>
              </div>
              <span className="text-[10px] text-slate-500">Search conversations…</span>
            </div>
          </div>
          <div className="flex gap-1 px-2.5 pb-2">
            {['All', 'Open', 'Bot'].map((tab, i) => (
              <span key={tab} className={`text-[9px] px-2 py-0.5 rounded-full font-medium ${i === 0 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-500 border border-white/[0.06]'}`}>
                {tab}
              </span>
            ))}
          </div>
          <div className="flex-1 overflow-hidden">
            {convos.map((c, i) => (
              <div key={c.name} className={`flex items-start gap-2 px-2.5 py-2 cursor-pointer transition-colors ${i === 0 ? 'bg-emerald-500/[0.08] border-l-2 border-emerald-500' : 'hover:bg-white/[0.03]'}`}>
                <div className={`w-7 h-7 rounded-full ${c.color} flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 relative`}>
                  {c.name[0]}
                  <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-[#090e18] ${c.status === 'online' ? 'bg-emerald-400' : c.status === 'away' ? 'bg-yellow-400' : 'bg-slate-500'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center">
                    <span className={`text-[10px] font-semibold truncate ${i === 0 ? 'text-white' : 'text-slate-300'}`}>{c.name}</span>
                    <span className="text-[9px] text-slate-600 flex-shrink-0 ml-1">{c.time}</span>
                  </div>
                  <p className="text-[9px] text-slate-500 truncate mt-0.5">{c.msg}</p>
                </div>
                {c.unread > 0 && (
                  <span className="w-4 h-4 rounded-full bg-emerald-500 text-white text-[8px] font-bold flex items-center justify-center flex-shrink-0">
                    {c.unread}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Chat area */}
        <div className="flex-1 flex flex-col bg-[#0a0f1a]">
          {/* Chat header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-violet-500 flex items-center justify-center text-[9px] font-bold text-white">S</div>
              <div>
                <p className="text-[10px] font-semibold text-white">Sarah Johnson</p>
                <div className="flex items-center gap-1">
                  <div className="w-1 h-1 rounded-full bg-emerald-400" />
                  <p className="text-[8px] text-emerald-400">WhatsApp · Online</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-medium">Open</span>
              <span className="text-[8px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-400 border border-violet-500/30 font-medium">VIP</span>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 px-3 py-2.5 flex flex-col gap-2 overflow-hidden">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[78%] px-2.5 py-1.5 rounded-xl text-[9px] leading-relaxed ${
                  msg.from === 'me'
                    ? 'bg-emerald-600/80 text-white rounded-br-sm'
                    : 'bg-white/[0.07] text-slate-200 rounded-bl-sm border border-white/[0.06]'
                }`}>
                  {msg.text}
                  <div className={`flex items-center gap-1 mt-0.5 ${msg.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                    <span className={`text-[8px] ${msg.from === 'me' ? 'text-emerald-200/70' : 'text-slate-500'}`}>{msg.time}</span>
                    {msg.from === 'me' && (
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
                        <path d="M1 4L3.5 6.5L7 2" stroke="#34d399" strokeWidth="1.2" strokeLinecap="round"/>
                        <path d="M5 4L7.5 6.5L11 2" stroke="#34d399" strokeWidth="1.2" strokeLinecap="round"/>
                      </svg>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {/* Typing indicator */}
            <div className="flex justify-start">
              <div className="bg-white/[0.07] border border-white/[0.06] px-3 py-2 rounded-xl rounded-bl-sm flex items-center gap-1">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-blink" style={{ animationDelay: `${i * 0.2}s` }} />
                ))}
              </div>
            </div>
          </div>

          {/* Input */}
          <div className="px-2.5 py-2 border-t border-white/[0.06]">
            <div className="flex items-center gap-2 bg-white/[0.05] rounded-xl px-3 py-2 border border-white/[0.07]">
              <span className="text-[9px] text-slate-500 flex-1">Type a message…</span>
              <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                <ArrowRight size={10} className="text-white" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center pt-16 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(16,185,129,0.12),transparent)]" />
        <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] bg-gradient-to-r from-emerald-500/5 to-teal-500/5 blur-3xl rounded-full" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-20 grid lg:grid-cols-2 gap-16 items-center">
        {/* Left */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-xl"
        >
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1, duration: 0.5 }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-semibold mb-6"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            AI-Powered Communication Platform
            <Zap size={11} />
          </motion.div>

          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.7 }}
            className="text-5xl sm:text-6xl font-extrabold leading-[1.08] tracking-tight text-white mb-5"
          >
            Scale Customer{' '}
            <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
              Conversations
            </span>{' '}
            Across Every Channel
          </motion.h1>

          {/* Subheadline */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.7 }}
            className="text-lg text-slate-400 leading-relaxed mb-8"
          >
            VerzChat unifies WhatsApp, email, live chat, and calls into one AI-powered inbox. Automate support, run campaigns, and close deals — at scale.
          </motion.p>

          {/* Trust points */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.6 }}
            className="flex flex-wrap gap-3 mb-8"
          >
            {['No credit card required', 'Free 14-day trial', 'Cancel anytime'].map((item) => (
              <div key={item} className="flex items-center gap-1.5 text-sm text-slate-400">
                <Check size={13} className="text-emerald-400 flex-shrink-0" />
                {item}
              </div>
            ))}
          </motion.div>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
            className="flex flex-wrap gap-3 mb-10"
          >
            <Link
              href="/auth/register"
              className="flex items-center gap-2 px-6 py-3.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-semibold rounded-xl hover:shadow-[0_0_30px_rgba(16,185,129,0.5)] transition-all duration-200 hover:scale-[1.02] text-sm"
            >
              Start Free Trial <ArrowRight size={15} />
            </Link>
            <Link
              href="#"
              className="flex items-center gap-2 px-6 py-3.5 bg-white/[0.06] border border-white/[0.1] text-white font-semibold rounded-xl hover:bg-white/[0.1] transition-all duration-200 text-sm"
            >
              Book a Demo
            </Link>
          </motion.div>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.55, duration: 0.6 }}
            className="flex items-center gap-6 pt-6 border-t border-white/[0.07]"
          >
            {[
              { value: '50M+', label: 'Messages sent' },
              { value: '10K+', label: 'Businesses' },
              { value: '99.9%', label: 'Uptime SLA' },
            ].map((stat) => (
              <div key={stat.label}>
                <p className="text-xl font-bold text-white">{stat.value}</p>
                <p className="text-xs text-slate-500 mt-0.5">{stat.label}</p>
              </div>
            ))}
          </motion.div>
        </motion.div>

        {/* Right — Inbox mockup */}
        <motion.div
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="relative hidden lg:block"
        >
          {/* Main mockup */}
          <motion.div
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
            className="relative z-10 rounded-2xl overflow-hidden shadow-[0_32px_80px_rgba(0,0,0,0.6)] border border-white/[0.08]"
            style={{ height: 440 }}
          >
            <InboxMockup />
          </motion.div>

          {/* Floating card: Analytics */}
          <FloatCard delay={1} className="absolute -top-6 -right-8 z-20 bg-[#0d1117]/90 backdrop-blur-xl border border-white/[0.1] rounded-2xl p-3.5 shadow-2xl min-w-[160px]">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                <TrendingUp size={12} className="text-emerald-400" />
              </div>
              <span className="text-xs font-semibold text-white">Today</span>
            </div>
            <p className="text-2xl font-bold text-white">1,247</p>
            <div className="flex items-center gap-1 mt-1">
              <span className="text-[10px] text-emerald-400 font-semibold">↑ 23%</span>
              <span className="text-[10px] text-slate-500">vs yesterday</span>
            </div>
            <div className="flex gap-0.5 mt-2">
              {[4, 6, 5, 8, 7, 10, 9, 12, 11, 14].map((h, i) => (
                <div key={i} className="w-2 bg-emerald-500/30 rounded-sm" style={{ height: h * 2 }} />
              ))}
            </div>
          </FloatCard>

          {/* Floating card: Live notification */}
          <FloatCard delay={0.5} className="absolute -left-8 top-8 z-20 bg-[#0d1117]/90 backdrop-blur-xl border border-white/[0.1] rounded-2xl p-3 shadow-2xl flex items-center gap-2.5 max-w-[220px]">
            <div className="w-8 h-8 rounded-full bg-[#25D366] flex items-center justify-center flex-shrink-0 shadow-[0_0_12px_rgba(37,211,102,0.4)]">
              <MessageSquare size={14} className="text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-white">New WhatsApp message</p>
              <p className="text-[9px] text-slate-400 truncate">John Doe: &quot;I need support...&quot;</p>
            </div>
            <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0 animate-ping-slow" />
          </FloatCard>

          {/* Floating card: AI replied */}
          <FloatCard delay={2} className="absolute -right-4 -bottom-4 z-20 bg-[#0d1117]/90 backdrop-blur-xl border border-violet-500/20 rounded-2xl p-3 shadow-2xl flex items-center gap-2.5 max-w-[200px]">
            <div className="w-7 h-7 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
              <Zap size={12} className="text-violet-400" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-white">AI Auto-replied</p>
              <p className="text-[9px] text-slate-400">Response time: 0.2s</p>
            </div>
          </FloatCard>

          {/* Floating: Team */}
          <FloatCard delay={1.5} className="absolute -left-4 bottom-16 z-20 bg-[#0d1117]/90 backdrop-blur-xl border border-white/[0.1] rounded-2xl p-3 shadow-2xl flex items-center gap-2">
            <div className="flex -space-x-1.5">
              {['bg-violet-500', 'bg-blue-500', 'bg-emerald-500'].map((c, i) => (
                <div key={i} className={`w-6 h-6 rounded-full ${c} border-2 border-[#0d1117] flex items-center justify-center text-[8px] font-bold text-white`}>
                  {['A', 'B', 'C'][i]}
                </div>
              ))}
            </div>
            <div>
              <p className="text-[10px] font-bold text-white">3 agents online</p>
              <p className="text-[9px] text-slate-400">Avg 1.2m response</p>
            </div>
          </FloatCard>

          {/* Glow behind mockup */}
          <div className="absolute inset-0 -z-10 blur-3xl opacity-30 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 scale-75 translate-y-10" />
        </motion.div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
      >
        <span className="text-xs text-slate-600">Scroll to explore</span>
        <motion.div
          animate={{ y: [0, 6, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          className="w-5 h-8 rounded-full border-2 border-slate-700 flex items-start justify-center pt-1.5"
        >
          <div className="w-1 h-2 rounded-full bg-slate-500" />
        </motion.div>
      </motion.div>
    </section>
  );
}
