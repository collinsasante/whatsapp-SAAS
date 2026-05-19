'use client';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, CheckCheck } from 'lucide-react';
import Link from 'next/link';

function useTypewriter(text: string, speed = 24, startDelay = 0) {
  const [displayed, setDisplayed] = useState('');
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setStarted(true), startDelay);
    return () => clearTimeout(t);
  }, [startDelay]);
  useEffect(() => {
    if (!started || displayed.length >= text.length) return;
    const t = setTimeout(() => setDisplayed(text.slice(0, displayed.length + 1)), speed);
    return () => clearTimeout(t);
  }, [displayed, text, speed, started]);
  return displayed;
}

function InboxPreview() {
  const [visible, setVisible] = useState(0);
  const [showPing, setShowPing] = useState(false);
  const aiText = useTypewriter('"I\'ve rebooked for 1–5pm today. You\'ll get a confirmation SMS shortly."', 22, 3000);

  const conversations = [
    { name: 'Sarah K.', preview: "My order still hasn't arrived...", time: '2m', unread: 2, color: 'bg-violet-500', ch: 'WA', active: true },
    { name: 'Gulf Trading', preview: 'Can we schedule a call?', time: '14m', unread: 1, color: 'bg-blue-500', ch: 'IG', active: false },
    { name: 'Ahmed Hassan', preview: 'Thanks, sorted! 👍', time: '1h', unread: 0, color: 'bg-emerald-500', ch: 'WA', active: false },
    { name: 'Maria R.', preview: 'Price for bulk order?', time: '2h', unread: 0, color: 'bg-orange-400', ch: 'WA', active: false },
  ];
  const messages = [
    { text: "Hi, order #4821 hasn't arrived and it's been 5 days.", from: 'them', time: '14:31' },
    { text: "Hi Sarah! I'm sorry about that. Let me pull up your order right now.", from: 'me', time: '14:32' },
    { text: "It's been at your local post office since yesterday. They tried delivery at 9am. Want me to rebook?", from: 'me', time: '14:32' },
    { text: 'Yes please, afternoon works better.', from: 'them', time: '14:33' },
  ];

  useEffect(() => {
    if (visible >= messages.length) return;
    const t = setTimeout(() => setVisible((v) => v + 1), visible === 0 ? 500 : 650);
    return () => clearTimeout(t);
  }, [visible, messages.length]);

  useEffect(() => {
    const t = setTimeout(() => setShowPing(true), 4200);
    return () => clearTimeout(t);
  }, []);

  const chColor = (ch: string) => ch === 'WA' ? 'bg-[#25D366]' : ch === 'IG' ? 'bg-pink-500' : 'bg-blue-500';

  return (
    <div className="w-full rounded-2xl overflow-hidden border border-gray-200 shadow-2xl bg-[#0d1117] relative" style={{ height: 400 }}>
      <AnimatePresence>
        {showPing && (
          <motion.div
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 60 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            className="absolute top-12 right-3 z-20 bg-[#161b22] border border-white/[0.12] rounded-xl px-3 py-2 flex items-center gap-2.5 shadow-xl"
          >
            <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">G</div>
            <div>
              <p className="text-[9px] font-bold text-white leading-none mb-0.5">Gulf Trading</p>
              <p className="text-[8px] text-slate-400">Can we schedule a call?</p>
            </div>
            <motion.div animate={{ scale: [1, 1.4, 1] }} transition={{ repeat: Infinity, duration: 1.8 }} className="w-1.5 h-1.5 rounded-full bg-[#25D366] ml-0.5 flex-shrink-0" />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center gap-1.5 px-4 py-2.5 bg-[#161b22] border-b border-white/[0.07]">
        <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
        <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
        <div className="w-2.5 h-2.5 rounded-full bg-[#25D366]/70" />
        <span className="text-[10px] text-slate-500 ml-2 font-medium select-none">VerzChat Inbox</span>
        <div className="ml-auto flex items-center gap-1.5">
          <motion.div animate={{ scale: [1, 1.4, 1] }} transition={{ repeat: Infinity, duration: 2 }} className="w-1.5 h-1.5 rounded-full bg-[#25D366]" />
          <span className="text-[10px] text-[#25D366] font-semibold">3 agents online</span>
        </div>
      </div>

      <div className="flex h-[calc(100%-36px)]">
        <div className="w-[40%] border-r border-white/[0.06] bg-[#0d1117] flex flex-col">
          <div className="px-2.5 py-2.5">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-white/[0.05] rounded-lg">
              <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-500"><circle cx="6" cy="6" r="4"/><path d="M11 11l3 3"/></svg>
              <span className="text-[9px] text-slate-500">Search…</span>
            </div>
          </div>
          <div className="flex gap-1 px-2.5 pb-2">
            {['All', 'Open', 'Done'].map((t, i) => (
              <span key={t} className={`text-[8px] px-2 py-0.5 rounded-full font-semibold ${i === 0 ? 'bg-[#25D366]/20 text-[#25D366] border border-[#25D366]/30' : 'text-slate-600 border border-white/[0.06]'}`}>{t}</span>
            ))}
          </div>
          <div className="flex-1 overflow-hidden">
            {conversations.map((c, i) => (
              <motion.div key={c.name} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 + 0.2, duration: 0.35 }}
                className={`flex items-start gap-2.5 px-3 py-2.5 cursor-pointer border-b border-white/[0.04] ${c.active ? 'bg-[#25D366]/[0.08] border-l-2 border-l-[#25D366]' : 'hover:bg-white/[0.03]'}`}>
                <div className={`w-7 h-7 rounded-full ${c.color} flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0 relative mt-0.5`}>
                  {c.name[0]}
                  <span className={`absolute -bottom-0.5 -right-0.5 text-[7px] w-3.5 h-3.5 rounded-full flex items-center justify-center font-bold ${chColor(c.ch)} text-white`}>{c.ch[0]}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center">
                    <span className={`text-[10px] font-semibold truncate ${c.active ? 'text-white' : 'text-slate-300'}`}>{c.name}</span>
                    <span className="text-[8px] text-slate-600 flex-shrink-0 ml-1">{c.time}</span>
                  </div>
                  <p className="text-[9px] text-slate-500 truncate mt-0.5">{c.preview}</p>
                </div>
                {c.unread > 0 && <span className="w-4 h-4 rounded-full bg-[#25D366] text-white text-[8px] flex items-center justify-center flex-shrink-0 mt-0.5 font-bold">{c.unread}</span>}
              </motion.div>
            ))}
          </div>
        </div>

        <div className="flex-1 flex flex-col bg-[#0a0f1a]">
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
                <div className="flex items-center gap-1 mt-0.5">
                  <motion.div animate={{ scale: [1, 1.4, 1] }} transition={{ repeat: Infinity, duration: 2 }} className="w-1 h-1 rounded-full bg-[#25D366]" />
                  <p className="text-[8px] text-[#25D366]">online now</p>
                </div>
              </div>
            </div>
            <span className="text-[7px] px-1.5 py-0.5 rounded bg-[#25D366]/20 text-[#25D366] border border-[#25D366]/30 font-bold">OPEN</span>
          </div>

          <div className="flex-1 px-3.5 py-3 space-y-2 overflow-hidden">
            {messages.slice(0, visible).map((msg, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                className={`flex ${msg.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-[9px] leading-relaxed ${msg.from === 'me' ? 'bg-[#25D366] text-white rounded-br-sm' : 'bg-white/[0.08] text-slate-200 rounded-bl-sm border border-white/[0.08]'}`}>
                  {msg.text}
                  {msg.from === 'me' && (
                    <div className="flex items-center justify-end gap-0.5 mt-1">
                      <span className="text-[8px] text-green-200/70">{msg.time}</span>
                      <CheckCheck size={9} className="text-green-200/70" />
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>

          <div className="px-3 pb-2.5">
            <AnimatePresence>
              {visible >= messages.length && (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
                  className="flex items-center gap-2 px-3 py-2 bg-[#25D366]/10 border border-[#25D366]/25 rounded-xl">
                  <div className="w-4 h-4 rounded bg-[#25D366]/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-[8px] text-[#25D366] font-bold">AI</span>
                  </div>
                  <p className="text-[9px] text-[#25D366]/80 flex-1 truncate">
                    {aiText || 'Verz is thinking…'}<span className="animate-pulse">{aiText.length < 10 ? '|' : ''}</span>
                  </p>
                  {aiText.length > 20 && <span className="text-[8px] text-[#25D366] font-bold flex-shrink-0 cursor-pointer hover:text-white transition-colors">Use ↵</span>}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Hero() {
  return (
    <section className="pt-20 pb-16 lg:pb-0 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-px bg-[#25D366]/30" />
      <div className="absolute top-0 left-0 right-0 h-96 bg-gradient-to-b from-[#f0fdf4] to-white pointer-events-none" />
      <motion.div animate={{ scale: [1, 1.18, 1], opacity: [0.35, 0.55, 0.35] }} transition={{ repeat: Infinity, duration: 9, ease: 'easeInOut' }}
        className="absolute top-20 -left-32 w-80 h-80 bg-[#25D366]/10 rounded-full blur-3xl pointer-events-none" />
      <motion.div animate={{ scale: [1, 1.22, 1], opacity: [0.25, 0.45, 0.25] }} transition={{ repeat: Infinity, duration: 11, ease: 'easeInOut', delay: 2.5 }}
        className="absolute top-0 -right-32 w-96 h-96 bg-teal-400/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative max-w-6xl mx-auto px-5 sm:px-8">
        <div className="grid lg:grid-cols-[1fr_1.1fr] gap-12 lg:gap-16 items-center min-h-[calc(100vh-60px)] lg:min-h-0 py-16 lg:py-24">
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#f0fdf4] border border-[#bbf7d0] text-[#15803d] text-xs font-semibold mb-6">
              <motion.div animate={{ scale: [1, 1.5, 1] }} transition={{ repeat: Infinity, duration: 2.2 }} className="w-1.5 h-1.5 rounded-full bg-[#25D366]" />
              Official WhatsApp Business API Partner
            </motion.div>

            <h1 className="text-4xl sm:text-5xl lg:text-[52px] font-extrabold text-gray-900 leading-[1.1] tracking-tight mb-5">
              Handle every customer<br />
              message from{' '}
              <span className="text-[#128C7E]">one inbox.</span>
            </h1>

            <p className="text-lg text-gray-500 leading-relaxed max-w-md mb-8">
              VerzChat turns WhatsApp into a proper team inbox. Every message, every customer, every agent in one place with real-time delivery so nothing gets missed.
            </p>

            <div className="flex flex-wrap items-center gap-3 mb-8">
              <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                <Link href="/auth/register" className="inline-flex items-center gap-2 px-6 py-3 bg-[#25D366] hover:bg-[#1aad57] text-white font-semibold rounded-xl transition-colors shadow-sm text-sm">
                  Book a demo <ArrowRight size={15} />
                </Link>
              </motion.div>
              <motion.a whileHover={{ scale: 1.03 }} href="#features" className="inline-flex items-center gap-2 px-5 py-3 border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-colors text-sm">
                See how it works
              </motion.a>
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-400">
              <span>7-day trial</span>
              <span>·</span>
              <span>Live in under 20 minutes</span>
              <span>·</span>
              <span>Cancel anytime</span>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.15, ease: [0.22, 1, 0.36, 1] }} className="relative">
            <InboxPreview />

            <motion.div initial={{ opacity: 0, scale: 0.9, x: -10 }} animate={{ opacity: 1, scale: 1, x: 0 }} transition={{ delay: 0.85, duration: 0.5, type: 'spring', stiffness: 200 }}
              whileHover={{ y: -3 }}
              className="absolute -bottom-4 -left-4 lg:-left-8 bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-lg flex items-center gap-3 cursor-default">
              <div className="w-8 h-8 rounded-full bg-[#f0fdf4] flex items-center justify-center flex-shrink-0">
                <CheckCheck size={15} className="text-[#25D366]" />
              </div>
              <div>
                <p className="text-xs font-bold text-gray-900">Delivered in 0.3s</p>
                <p className="text-[11px] text-gray-400">Avg across all channels</p>
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, scale: 0.9, x: 10 }} animate={{ opacity: 1, scale: 1, x: 0 }} transition={{ delay: 1, duration: 0.5, type: 'spring', stiffness: 200 }}
              whileHover={{ y: -3 }}
              className="absolute -top-4 -right-2 lg:-right-6 bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-lg cursor-default">
              <div className="flex items-center gap-2 mb-0.5">
                <motion.div animate={{ scale: [1, 1.4, 1] }} transition={{ repeat: Infinity, duration: 2.5 }} className="w-2 h-2 rounded-full bg-[#25D366]" />
                <p className="text-xs font-bold text-gray-900">99.9% uptime</p>
              </div>
              <p className="text-[11px] text-gray-400">Last 12 months</p>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
