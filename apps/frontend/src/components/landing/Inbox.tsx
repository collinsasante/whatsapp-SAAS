'use client';
import { motion } from 'framer-motion';
import { MessageSquare, CheckCheck, Bot, Tag, StickyNote, UserCheck, Smile, Zap } from 'lucide-react';

const inboxFeatures = [
  { icon: Bot, label: 'AI Assist', color: 'text-violet-400 bg-violet-500/10 border-violet-500/20' },
  { icon: Tag, label: 'Smart Tags', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
  { icon: StickyNote, label: 'Private Notes', color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' },
  { icon: UserCheck, label: 'Assign Agent', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  { icon: Smile, label: 'Reactions', color: 'text-pink-400 bg-pink-500/10 border-pink-500/20' },
  { icon: CheckCheck, label: 'Read Status', color: 'text-teal-400 bg-teal-500/10 border-teal-500/20' },
];

export default function Inbox() {
  return (
    <section className="py-24 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-emerald-950/8 to-transparent pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left — full inbox mockup */}
          <motion.div
            initial={{ opacity: 0, x: -40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="relative"
          >
            <div className="relative bg-[#0a0f1a] border border-white/[0.08] rounded-2xl overflow-hidden shadow-[0_32px_80px_rgba(0,0,0,0.5)]" style={{ height: 520 }}>
              {/* Tab bar */}
              <div className="flex items-center border-b border-white/[0.06] bg-[#0d1117]">
                {['All', 'Open', 'Pending', 'Resolved'].map((tab, i) => (
                  <button key={tab} className={`px-4 py-2.5 text-[10px] font-semibold border-b-2 transition-colors ${i === 0 ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
                    {tab}
                    {i < 2 && <span className={`ml-1.5 px-1 rounded-full text-[8px] ${i === 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/[0.06] text-slate-500'}`}>{[24, 8][i]}</span>}
                  </button>
                ))}
              </div>

              <div className="flex h-[calc(100%-36px)]">
                {/* Conversation list */}
                <div className="w-[42%] border-r border-white/[0.06] overflow-hidden">
                  {[
                    { name: 'Sarah Johnson', msg: "Hi, I need help with...", time: '2m', unread: 3, color: 'bg-violet-500', tag: 'VIP', channel: '💬' },
                    { name: 'Tech Corp', msg: 'Can we schedule a demo?', time: '8m', unread: 1, color: 'bg-blue-500', tag: 'Lead', channel: '📧' },
                    { name: 'Ahmed Al-Farsi', msg: 'Perfect, thank you! 👍', time: '15m', unread: 0, color: 'bg-emerald-500', tag: '', channel: '💬' },
                    { name: 'Maria Santos', msg: 'When will my package...', time: '1h', unread: 2, color: 'bg-orange-500', tag: 'Order', channel: '💬' },
                    { name: 'Team Bot 🤖', msg: 'Auto-replied to 12 chats', time: '2h', unread: 0, color: 'bg-slate-600', tag: 'Bot', channel: '🤖' },
                    { name: 'Dev Newsletter', msg: 'Campaign sent to 1,243', time: '3h', unread: 0, color: 'bg-pink-500', tag: 'Campaign', channel: '📣' },
                  ].map((conv, i) => (
                    <div key={conv.name} className={`flex items-start gap-2 px-3 py-2.5 cursor-pointer transition-colors ${i === 0 ? 'bg-emerald-500/[0.07] border-l-2 border-emerald-500' : 'hover:bg-white/[0.02]'} border-b border-white/[0.04]`}>
                      <div className={`w-7 h-7 rounded-full ${conv.color} flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 mt-0.5 relative`}>
                        {conv.name[0]}
                        <span className="absolute -bottom-0.5 -right-0.5 text-[9px]">{conv.channel}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center">
                          <span className={`text-[10px] font-semibold truncate ${i === 0 ? 'text-white' : 'text-slate-300'}`}>{conv.name}</span>
                          <span className="text-[8px] text-slate-600 flex-shrink-0">{conv.time}</span>
                        </div>
                        <p className="text-[9px] text-slate-500 truncate mt-0.5">{conv.msg}</p>
                        {conv.tag && (
                          <span className="text-[7px] px-1.5 py-0.5 rounded-full bg-white/[0.06] text-slate-500 mt-0.5 inline-block">{conv.tag}</span>
                        )}
                      </div>
                      {conv.unread > 0 && (
                        <span className="w-4 h-4 rounded-full bg-emerald-500 text-white text-[8px] flex items-center justify-center flex-shrink-0 mt-0.5 font-bold">{conv.unread}</span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Active chat */}
                <div className="flex-1 flex flex-col">
                  {/* Header */}
                  <div className="px-3 py-2 border-b border-white/[0.06] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-violet-500 flex items-center justify-center text-[9px] font-bold text-white relative">
                        S
                        <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 border border-[#0a0f1a]" />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-white">Sarah Johnson</p>
                        <p className="text-[8px] text-emerald-400">WhatsApp · online</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[8px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/20">VIP</span>
                      <div className="w-5 h-5 rounded-lg bg-white/[0.05] flex items-center justify-center">
                        <Bot size={9} className="text-violet-400" />
                      </div>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 px-3 py-3 space-y-2 overflow-hidden">
                    {[
                      { t: "Hi! I need help with my order #4821", from: 'them' },
                      { t: "Hi Sarah! 👋 Let me look that up for you right away.", from: 'me' },
                      { t: "I can see it's in transit — expected by tomorrow before 6pm.", from: 'me' },
                      { t: "Thank you! Can you send me the tracking link?", from: 'them' },
                      { t: "Of course! I've sent it to your WhatsApp. Anything else?", from: 'me' },
                    ].map((msg, i) => (
                      <div key={i} className={`flex ${msg.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] px-2.5 py-1.5 rounded-xl text-[9px] leading-relaxed ${msg.from === 'me' ? 'bg-emerald-600/80 text-white rounded-br-sm' : 'bg-white/[0.07] text-slate-200 rounded-bl-sm border border-white/[0.06]'}`}>
                          {msg.t}
                        </div>
                      </div>
                    ))}

                    {/* Note */}
                    <div className="flex items-start gap-1.5 px-2 py-1.5 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
                      <StickyNote size={9} className="text-yellow-400 mt-0.5 flex-shrink-0" />
                      <p className="text-[9px] text-yellow-300/80">Internal note: Customer is a Premium subscriber, offer priority support</p>
                    </div>
                  </div>

                  {/* Typing */}
                  <div className="px-3 pb-1.5">
                    <div className="flex items-center gap-1.5 text-[9px] text-slate-500">
                      <div className="flex gap-0.5">
                        {[0, 1, 2].map((i) => <div key={i} className="w-1 h-1 rounded-full bg-slate-500 animate-blink" style={{ animationDelay: `${i * 0.2}s` }} />)}
                      </div>
                      Sarah is typing…
                    </div>
                  </div>

                  {/* Input */}
                  <div className="px-2.5 pb-2.5">
                    <div className="flex items-center gap-2 bg-white/[0.05] rounded-xl px-3 py-2 border border-white/[0.07]">
                      <Zap size={10} className="text-violet-400 flex-shrink-0" />
                      <span className="text-[9px] text-slate-500 flex-1">AI suggested: "Happy to help! Your order..."</span>
                      <span className="text-[8px] text-emerald-400 font-semibold cursor-pointer">Use ↵</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Glow */}
            <div className="absolute inset-0 -z-10 blur-3xl opacity-20 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-full scale-75" />
          </motion.div>

          {/* Right — features list */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
          >
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs font-semibold text-emerald-400 mb-4">
              <MessageSquare size={11} />
              Shared Team Inbox
            </span>
            <h2 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight mb-5 leading-tight">
              Built for teams that{' '}
              <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">move fast</span>
            </h2>
            <p className="text-lg text-slate-400 leading-relaxed mb-8">
              Collaborate without chaos. VerzChat's shared inbox gives your team every tool to deliver exceptional support, without stepping on each other.
            </p>

            <div className="grid grid-cols-2 gap-3 mb-8">
              {inboxFeatures.map((feat, i) => (
                <motion.div
                  key={feat.label}
                  initial={{ opacity: 0, y: 15 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08 }}
                  className={`flex items-center gap-2.5 p-3 rounded-xl border ${feat.color.split(' ').slice(1).join(' ')} transition-all hover:scale-[1.02]`}
                >
                  <div className={`w-7 h-7 rounded-lg border flex items-center justify-center ${feat.color}`}>
                    <feat.icon size={13} />
                  </div>
                  <span className="text-sm font-semibold text-white">{feat.label}</span>
                </motion.div>
              ))}
            </div>

            <div className="flex items-center gap-4 p-4 bg-emerald-500/[0.06] border border-emerald-500/20 rounded-xl">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                <Zap size={18} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">AI Assistant built-in</p>
                <p className="text-xs text-slate-400">Suggest replies, summarize conversations, and auto-categorize — powered by GPT-4o.</p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
