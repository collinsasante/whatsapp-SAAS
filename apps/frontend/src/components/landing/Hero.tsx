'use client';
import { motion } from 'framer-motion';
import { ArrowRight, CheckCheck } from 'lucide-react';
import Link from 'next/link';

function InboxPreview() {
  const conversations = [
    { name: 'Sarah K.', preview: 'My order still hasn\'t arrived...', time: '2m', unread: 2, color: 'bg-violet-500', channel: 'WA', active: true },
    { name: 'Gulf Trading Co.', preview: 'Can we schedule a call?', time: '14m', unread: 1, color: 'bg-blue-500', channel: 'Email', active: false },
    { name: 'Ahmed Hassan', preview: 'Thanks, sorted! 👍', time: '1h', unread: 0, color: 'bg-emerald-500', channel: 'WA', active: false },
    { name: 'Maria R.', preview: 'Price for bulk order?', time: '2h', unread: 0, color: 'bg-orange-400', channel: 'WA', active: false },
  ];

  const messages = [
    { text: "Hi, my order #4821 still hasn't arrived and it's been 5 days.", from: 'them', time: '14:31' },
    { text: "Hi Sarah! I'm sorry about that. Let me pull up your order right now.", from: 'me', time: '14:32' },
    { text: "I can see it's at your local post office since yesterday. They tried delivery at 9am. Want me to rebook the delivery?", from: 'me', time: '14:32' },
    { text: "Yes please! Afternoon would be better.", from: 'them', time: '14:33' },
  ];

  return (
    <div className="w-full rounded-2xl overflow-hidden border border-gray-200 shadow-2xl bg-[#0d1117]" style={{ height: 400 }}>
      {/* Title bar */}
      <div className="flex items-center gap-1.5 px-4 py-2.5 bg-[#161b22] border-b border-white/[0.07]">
        <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
        <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
        <div className="w-2.5 h-2.5 rounded-full bg-[#25D366]/70" />
        <span className="text-[10px] text-slate-500 ml-2 font-medium select-none">VerzChat Inbox</span>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-[#25D366] animate-pulse" />
          <span className="text-[10px] text-[#25D366] font-semibold">3 agents online</span>
        </div>
      </div>

      <div className="flex h-[calc(100%-36px)]">
        {/* Conversation list */}
        <div className="w-[40%] border-r border-white/[0.06] bg-[#0d1117] flex flex-col">
          <div className="px-2.5 py-2.5">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-white/[0.05] rounded-lg">
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-500"><circle cx="6" cy="6" r="4"/><path d="M11 11l3 3"/></svg>
              <span className="text-[9px] text-slate-500">Search…</span>
            </div>
          </div>

          <div className="flex gap-1 px-2.5 pb-2">
            {['All', 'Open', 'Resolved'].map((tab, i) => (
              <span key={tab} className={`text-[8px] px-2 py-0.5 rounded-full font-semibold cursor-pointer ${i === 0 ? 'bg-[#25D366]/20 text-[#25D366] border border-[#25D366]/30' : 'text-slate-600 border border-white/[0.06] hover:text-slate-400'}`}>
                {tab}
              </span>
            ))}
          </div>

          <div className="flex-1 overflow-hidden">
            {conversations.map((c, i) => (
              <div
                key={c.name}
                className={`flex items-start gap-2.5 px-3 py-2.5 cursor-pointer border-b border-white/[0.04] ${
                  c.active ? 'bg-[#25D366]/[0.08] border-l-[2px] border-l-[#25D366]' : 'hover:bg-white/[0.03]'
                }`}
              >
                <div className={`w-7 h-7 rounded-full ${c.color} flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0 relative mt-0.5`}>
                  {c.name[0]}
                  <span className={`absolute -bottom-0.5 -right-0.5 text-[7px] w-3.5 h-3.5 rounded-full flex items-center justify-center font-bold ${c.channel === 'WA' ? 'bg-[#25D366]' : 'bg-orange-500'} text-white`}>
                    {c.channel === 'WA' ? 'W' : 'E'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center">
                    <span className={`text-[10px] font-semibold truncate ${c.active ? 'text-white' : 'text-slate-300'}`}>{c.name}</span>
                    <span className="text-[8px] text-slate-600 flex-shrink-0 ml-1">{c.time}</span>
                  </div>
                  <p className="text-[9px] text-slate-500 truncate mt-0.5">{c.preview}</p>
                </div>
                {c.unread > 0 && (
                  <span className="w-4 h-4 rounded-full bg-[#25D366] text-white text-[8px] flex items-center justify-center flex-shrink-0 mt-0.5 font-bold">{c.unread}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Active chat */}
        <div className="flex-1 flex flex-col bg-[#0a0f1a]">
          {/* Chat header */}
          <div className="px-3.5 py-2.5 border-b border-white/[0.06] flex items-center justify-between bg-[#0d1117]">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-violet-500 flex items-center justify-center text-[9px] font-bold text-white relative">
                S
                <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#25D366] border border-[#0d1117] flex items-center justify-center">
                  <span className="text-[6px] text-white font-bold">W</span>
                </div>
              </div>
              <div>
                <p className="text-[10px] font-bold text-white leading-none">Sarah K.</p>
                <p className="text-[8px] text-[#25D366] mt-0.5">WhatsApp · online now</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[7px] px-1.5 py-0.5 rounded bg-[#25D366]/20 text-[#25D366] border border-[#25D366]/30 font-bold">OPEN</span>
              <div className="flex -space-x-1">
                {['bg-violet-500', 'bg-blue-500'].map((c, i) => (
                  <div key={i} className={`w-4.5 h-4.5 rounded-full ${c} border border-[#0d1117] flex items-center justify-center text-[7px] font-bold text-white`} style={{ width: 18, height: 18 }}>
                    {['A', 'B'][i]}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 px-3.5 py-3 space-y-2.5 overflow-hidden">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-[9px] leading-relaxed ${
                  msg.from === 'me'
                    ? 'bg-[#25D366] text-white rounded-br-sm'
                    : 'bg-white/[0.08] text-slate-200 rounded-bl-sm border border-white/[0.08]'
                }`}>
                  {msg.text}
                  {msg.from === 'me' && (
                    <div className="flex items-center justify-end gap-0.5 mt-1">
                      <span className="text-[8px] text-green-200/70">{msg.time}</span>
                      <CheckCheck size={9} className="text-green-200/70" />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* AI suggestion bar */}
          <div className="px-3 pb-2.5">
            <div className="flex items-center gap-2 px-3 py-2 bg-[#25D366]/10 border border-[#25D366]/25 rounded-xl">
              <div className="w-4 h-4 rounded bg-[#25D366]/20 flex items-center justify-center flex-shrink-0">
                <span className="text-[8px] text-[#25D366] font-bold">AI</span>
              </div>
              <p className="text-[9px] text-[#25D366]/80 flex-1 truncate">Suggested: "Of course! I've rebooked for between 1–5pm today. You'll get a confirmation SMS."</p>
              <span className="text-[8px] text-[#25D366] font-bold flex-shrink-0 cursor-pointer hover:text-white transition-colors">Use ↵</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Hero() {
  return (
    <section className="pt-20 pb-16 lg:pb-0 relative overflow-hidden">
      {/* Very subtle green tint at the very top */}
      <div className="absolute top-0 left-0 right-0 h-px bg-[#25D366]/30" />
      <div className="absolute top-0 left-0 right-0 h-80 bg-gradient-to-b from-[#f0fdf4] to-white pointer-events-none" />

      <div className="relative max-w-6xl mx-auto px-5 sm:px-8">
        <div className="grid lg:grid-cols-[1fr_1.1fr] gap-12 lg:gap-16 items-center min-h-[calc(100vh-60px)] lg:min-h-0 py-16 lg:py-24">

          {/* Left */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#f0fdf4] border border-[#bbf7d0] text-[#15803d] text-xs font-semibold mb-6">
              <div className="w-1.5 h-1.5 rounded-full bg-[#25D366]" />
              Official WhatsApp Business API Partner
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-[52px] font-extrabold text-gray-900 leading-[1.1] tracking-tight mb-5">
              Handle every customer<br />
              message from{' '}
              <span className="text-[#128C7E]">one inbox.</span>
            </h1>

            <p className="text-lg text-gray-500 leading-relaxed max-w-md mb-8">
              VerzChat connects WhatsApp, email, and live chat into a single workspace your whole team can use, with real-time delivery so nothing gets missed.
            </p>

            <div className="flex flex-wrap items-center gap-3 mb-8">
              <Link
                href="/auth/register"
                className="inline-flex items-center gap-2 px-5 py-3 bg-[#25D366] hover:bg-[#1aad57] text-white font-semibold rounded-xl transition-colors shadow-sm text-sm"
              >
                Start free, no card needed <ArrowRight size={15} />
              </Link>
              <a
                href="#features"
                className="inline-flex items-center gap-2 px-5 py-3 border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-colors text-sm"
              >
                See how it works
              </a>
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-400">
              <span>14-day trial</span>
              <span>·</span>
              <span>Up and running in 20 min</span>
              <span>·</span>
              <span>Cancel anytime</span>
            </div>
          </motion.div>

          {/* Right — product preview */}
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="relative"
          >
            <InboxPreview />

            {/* Delivery speed badge */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.6, duration: 0.4 }}
              className="absolute -bottom-4 -left-4 lg:-left-8 bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-lg flex items-center gap-3"
            >
              <div className="w-8 h-8 rounded-full bg-[#f0fdf4] flex items-center justify-center flex-shrink-0">
                <CheckCheck size={15} className="text-[#25D366]" />
              </div>
              <div>
                <p className="text-xs font-bold text-gray-900">Delivered in 0.3s</p>
                <p className="text-[11px] text-gray-400">Avg across all channels</p>
              </div>
            </motion.div>

            {/* Uptime badge */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.75, duration: 0.4 }}
              className="absolute -top-4 -right-2 lg:-right-6 bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-lg"
            >
              <p className="text-xs font-bold text-gray-900">99.9% uptime</p>
              <p className="text-[11px] text-gray-400">Last 12 months</p>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
