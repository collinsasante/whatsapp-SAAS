'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Clock, TrendingUp, Zap, Star, MessageSquare } from 'lucide-react';

const MESSAGES = [
  { from: 'customer', name: 'Amara S.', text: "Hi, I ordered last week and still haven't gotten a shipping update?" },
  { from: 'ai', text: "Hi Amara! 👋 I can see your order #7283 — it was dispatched today. You'll get a tracking link within the hour." },
  { from: 'customer', name: 'Amara S.', text: 'Amazing! Can I still change the delivery address?' },
  { from: 'ai', text: "Absolutely — let me connect you with our team right now so we can update that before it ships. 🙌" },
  { from: 'agent', name: 'Kezia (Support)', text: "Hi Amara! Address updated to 42 Elm St. All sorted — thanks for your patience! 😊" },
];

export default function Hero() {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (shown >= MESSAGES.length) return;
    const t = setTimeout(() => setShown(n => n + 1), 1600);
    return () => clearTimeout(t);
  }, [shown]);

  return (
    <section className="relative min-h-screen flex items-center pt-16 overflow-hidden" style={{ background: '#020917' }}>
      {/* Grid */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: 'linear-gradient(rgba(20,184,166,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(20,184,166,0.05) 1px,transparent 1px)',
        backgroundSize: '60px 60px',
      }} />
      {/* Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-teal-500/10 blur-[140px] rounded-full pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-28 w-full">
        <div className="grid lg:grid-cols-[1fr_1.15fr] gap-14 lg:gap-20 items-center">

          {/* Copy */}
          <div className="text-center lg:text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-teal-500/10 border border-teal-500/25 text-teal-400 text-xs font-semibold mb-6 tracking-wide uppercase">
              <Zap size={11} className="fill-teal-400" />
              AI that learns your business in 30 days
            </div>

            <h1 className="text-5xl sm:text-[3.75rem] lg:text-[4.5rem] font-extrabold text-white leading-[1.06] tracking-tight mb-5">
              Customer support{' '}
              <span className="bg-gradient-to-r from-teal-400 via-emerald-300 to-teal-400 bg-clip-text text-transparent">
                that feels human
              </span>
              <br />at AI scale
            </h1>

            <p className="text-lg text-slate-400 leading-relaxed max-w-lg mx-auto lg:mx-0 mb-8">
              VerzChat trains on your real conversations, then responds across WhatsApp, Instagram, and Messenger — empathetically, personally, just like your best team member.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start mb-8">
              <Link href="/register" className="flex items-center justify-center gap-2 px-6 py-3.5 bg-teal-500 hover:bg-teal-400 text-white font-bold rounded-xl transition-all duration-200 text-sm shadow-xl shadow-teal-500/30 hover:shadow-teal-500/50 hover:-translate-y-px">
                Start 14-day free trial
                <ArrowRight size={15} />
              </Link>
              <Link href="#how-it-works" className="flex items-center justify-center gap-2 px-6 py-3.5 bg-white/5 hover:bg-white/8 text-white font-medium rounded-xl border border-white/12 transition-colors text-sm">
                See how it works
              </Link>
            </div>

            <div className="flex flex-wrap items-center gap-5 justify-center lg:justify-start text-sm text-slate-500">
              {['No credit card required', 'Setup in 10 minutes', 'Cancel anytime'].map(t => (
                <span key={t} className="flex items-center gap-1.5">
                  <CheckCircle2 size={13} className="text-teal-500 flex-shrink-0" />
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* Chat mockup */}
          <div className="relative mx-auto w-full max-w-md lg:max-w-none">
            <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-black/50" style={{ background: '#0d1117' }}>
              {/* Window chrome */}
              <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/6" style={{ background: '#161b22' }}>
                <div className="w-3 h-3 rounded-full bg-red-500/70" />
                <div className="w-3 h-3 rounded-full bg-amber-500/70" />
                <div className="w-3 h-3 rounded-full bg-emerald-500/70" />
                <div className="ml-3 flex items-center gap-2 flex-1 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-teal-500/20 flex items-center justify-center text-teal-400 text-[10px] font-bold flex-shrink-0">AS</div>
                  <div className="min-w-0">
                    <p className="text-white text-xs font-semibold">Amara S.</p>
                    <p className="text-slate-500 text-[10px]">WhatsApp · Online</p>
                  </div>
                  <div className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-500/10 border border-teal-500/25 flex-shrink-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
                    <span className="text-teal-400 text-[10px] font-semibold">VerzAI</span>
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div className="p-4 space-y-3 min-h-[300px] max-h-[320px] overflow-hidden">
                {MESSAGES.slice(0, shown).map((msg, i) => (
                  <div key={i} className={`flex ${msg.from === 'customer' ? 'justify-start' : 'justify-end'}`} style={{ animation: 'fadeUp 0.4s ease-out' }}>
                    <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                      msg.from === 'customer' ? 'bg-white/8 text-slate-200 rounded-tl-sm' :
                      msg.from === 'ai' ? 'bg-teal-600 text-white rounded-tr-sm' :
                      'bg-blue-600 text-white rounded-tr-sm'
                    }`}>
                      {msg.from !== 'customer' && (
                        <p className="text-[10px] font-semibold mb-1 opacity-75">
                          {msg.from === 'ai' ? '🤖 VerzAI' : `👤 ${msg.name}`}
                        </p>
                      )}
                      <p>{msg.text}</p>
                    </div>
                  </div>
                ))}
                {shown < MESSAGES.length && shown > 0 && (
                  <div className="flex justify-end">
                    <div className="bg-teal-600/60 rounded-2xl rounded-tr-sm px-4 py-3">
                      <div className="flex gap-1 items-center">
                        {[0, 150, 300].map(d => (
                          <span key={d} className="w-1.5 h-1.5 bg-white/70 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Stats footer */}
              <div className="grid grid-cols-3 border-t border-white/6 divide-x divide-white/6">
                {[
                  { val: '94%', sub: 'Auto-resolved', Icon: MessageSquare },
                  { val: '<2s', sub: 'Response time', Icon: Clock },
                  { val: '4.9★', sub: 'CSAT score', Icon: TrendingUp },
                ].map(({ val, sub, Icon }) => (
                  <div key={sub} className="flex flex-col items-center py-3 px-2">
                    <span className="text-white font-bold text-sm">{val}</span>
                    <span className="text-slate-500 text-[10px] mt-0.5">{sub}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Floating badges */}
            <div className="absolute -top-3 -right-3 bg-emerald-500 text-white text-[11px] font-bold px-2.5 py-1 rounded-full shadow-lg shadow-emerald-500/30">
              🧠 AI learning…
            </div>
            <div className="absolute -bottom-3 -left-3 bg-[#0d1117] border border-white/12 text-slate-300 text-[11px] px-2.5 py-1.5 rounded-xl shadow-lg flex items-center gap-1.5">
              <Star size={11} className="text-amber-400 fill-amber-400" />
              Powered by your own data
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
