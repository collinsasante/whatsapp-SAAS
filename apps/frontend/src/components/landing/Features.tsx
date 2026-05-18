'use client';
import { motion } from 'framer-motion';
import {
  MessageSquare, Zap, Globe, Bot, Megaphone, GitBranch,
  PhoneCall, BarChart3, Users, UserCheck, BookOpen, Tag
} from 'lucide-react';

const features = [
  {
    icon: MessageSquare,
    title: 'Shared Team Inbox',
    desc: 'One unified inbox for your entire team. Assign, resolve, and collaborate on conversations in real-time.',
    color: 'from-emerald-500 to-teal-600',
    glow: 'rgba(16,185,129,0.25)',
    preview: (
      <div className="mt-3 bg-black/30 rounded-xl p-3 border border-white/[0.06] space-y-1.5">
        {['Sarah → Support', 'Tech Corp → Sales', 'Ahmed → Bot'].map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-[10px]">
            <div className={`w-2 h-2 rounded-full ${['bg-emerald-400', 'bg-blue-400', 'bg-violet-400'][i]}`} />
            <span className="text-slate-400">{item}</span>
            <span className="ml-auto text-slate-600">{['Open', 'Pending', 'Bot'][i]}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: Zap,
    title: 'WhatsApp Business API',
    desc: 'Official Meta Business Partner. Send messages, media, buttons, and templates at scale.',
    color: 'from-[#25D366] to-emerald-500',
    glow: 'rgba(37,211,102,0.25)',
    preview: (
      <div className="mt-3 bg-black/30 rounded-xl p-3 border border-white/[0.06]">
        <div className="flex items-center gap-1.5 mb-2">
          <div className="w-4 h-4 rounded-full bg-[#25D366] flex items-center justify-center">
            <MessageSquare size={8} className="text-white" />
          </div>
          <span className="text-[10px] text-slate-400 font-medium">WhatsApp Connected</span>
          <div className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        </div>
        <div className="text-[9px] text-slate-500 space-y-1">
          <div className="flex justify-between"><span>Messages/day</span><span className="text-emerald-400">∞ unlimited</span></div>
          <div className="flex justify-between"><span>Templates</span><span className="text-white">47 approved</span></div>
        </div>
      </div>
    ),
  },
  {
    icon: Globe,
    title: 'Omnichannel Messaging',
    desc: 'WhatsApp, Instagram, Facebook, Telegram, email, and live chat — all in one platform.',
    color: 'from-blue-500 to-cyan-500',
    glow: 'rgba(59,130,246,0.25)',
    preview: (
      <div className="mt-3 flex flex-wrap gap-1.5">
        {[
          { name: 'WhatsApp', bg: 'bg-[#25D366]/20 border-[#25D366]/30 text-[#25D366]' },
          { name: 'Instagram', bg: 'bg-pink-500/20 border-pink-500/30 text-pink-400' },
          { name: 'Telegram', bg: 'bg-blue-500/20 border-blue-500/30 text-blue-400' },
          { name: 'Email', bg: 'bg-orange-500/20 border-orange-500/30 text-orange-400' },
        ].map((ch) => (
          <span key={ch.name} className={`text-[9px] px-2 py-0.5 rounded-full border font-medium ${ch.bg}`}>{ch.name}</span>
        ))}
      </div>
    ),
  },
  {
    icon: Bot,
    title: 'AI Chatbots',
    desc: 'Build no-code chatbot flows. Let AI handle FAQs, qualify leads, and escalate to agents seamlessly.',
    color: 'from-violet-500 to-purple-600',
    glow: 'rgba(139,92,246,0.25)',
    preview: (
      <div className="mt-3 bg-black/30 rounded-xl p-3 border border-white/[0.06]">
        <div className="flex items-center gap-1.5 mb-2">
          <div className="w-4 h-4 rounded bg-violet-500/20 flex items-center justify-center">
            <Bot size={9} className="text-violet-400" />
          </div>
          <span className="text-[9px] text-slate-400">AI handled 82% of chats</span>
        </div>
        <div className="h-1 bg-white/[0.06] rounded-full">
          <div className="h-full w-[82%] bg-gradient-to-r from-violet-500 to-purple-500 rounded-full" />
        </div>
      </div>
    ),
  },
  {
    icon: Megaphone,
    title: 'Broadcast Campaigns',
    desc: 'Send targeted WhatsApp campaigns to segmented audiences. Track delivery, reads, and clicks in real-time.',
    color: 'from-orange-500 to-amber-500',
    glow: 'rgba(249,115,22,0.25)',
    preview: (
      <div className="mt-3 bg-black/30 rounded-xl p-3 border border-white/[0.06] space-y-1.5">
        {[['Delivered', '98.2%', 'text-emerald-400'], ['Read', '67.4%', 'text-blue-400'], ['Clicked', '12.1%', 'text-orange-400']].map(([k, v, c]) => (
          <div key={k} className="flex justify-between text-[9px]">
            <span className="text-slate-500">{k}</span>
            <span className={`font-bold ${c}`}>{v}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: GitBranch,
    title: 'Workflow Automation',
    desc: 'Automate repetitive tasks. Route conversations, send follow-ups, and trigger actions based on conditions.',
    color: 'from-teal-500 to-cyan-500',
    glow: 'rgba(20,184,166,0.25)',
    preview: (
      <div className="mt-3 bg-black/30 rounded-xl p-3 border border-white/[0.06]">
        <div className="space-y-1.5">
          {['Trigger: New message', '→ Check: Contains "price"', '→ Send: Pricing template'].map((step, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[9px] text-slate-400">
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${['bg-teal-400', 'bg-blue-400', 'bg-emerald-400'][i]}`} />
              {step}
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    icon: PhoneCall,
    title: 'Voice Calls',
    desc: 'In-app audio and video calls with recordings, transcriptions, and call analytics for your team.',
    color: 'from-pink-500 to-rose-600',
    glow: 'rgba(236,72,153,0.25)',
    preview: (
      <div className="mt-3 bg-black/30 rounded-xl p-3 border border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
            <PhoneCall size={12} className="text-emerald-400" />
          </div>
          <div>
            <p className="text-[9px] text-white font-medium">Active call · 3:42</p>
            <p className="text-[8px] text-slate-500">John Doe — Sales</p>
          </div>
          <div className="ml-auto w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        </div>
      </div>
    ),
  },
  {
    icon: BarChart3,
    title: 'Advanced Analytics',
    desc: 'Deep insights into team performance, conversation metrics, CSAT scores, and campaign effectiveness.',
    color: 'from-indigo-500 to-blue-600',
    glow: 'rgba(99,102,241,0.25)',
    preview: (
      <div className="mt-3 flex gap-0.5 items-end h-10">
        {[3, 5, 4, 7, 6, 8, 7, 9, 8, 10, 9, 11].map((h, i) => (
          <div key={i} className="flex-1 rounded-sm bg-gradient-to-t from-indigo-500/60 to-indigo-500/20" style={{ height: `${h * 8}%` }} />
        ))}
      </div>
    ),
  },
  {
    icon: Users,
    title: 'CRM & Contacts',
    desc: 'Full contact management with notes, tags, conversation history, and custom attributes.',
    color: 'from-cyan-500 to-sky-600',
    glow: 'rgba(6,182,212,0.25)',
    preview: (
      <div className="mt-3 bg-black/30 rounded-xl p-3 border border-white/[0.06] space-y-1.5">
        {[{ name: 'Sarah J.', tag: 'VIP', color: 'text-amber-400' }, { name: 'Ahmed F.', tag: 'Lead', color: 'text-blue-400' }, { name: 'Maria S.', tag: 'Customer', color: 'text-emerald-400' }].map((c) => (
          <div key={c.name} className="flex items-center gap-2 text-[9px]">
            <div className="w-4 h-4 rounded-full bg-slate-600 flex items-center justify-center text-[7px] font-bold text-white">{c.name[0]}</div>
            <span className="text-slate-400">{c.name}</span>
            <span className={`ml-auto font-semibold ${c.color}`}>{c.tag}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: UserCheck,
    title: 'Team Collaboration',
    desc: 'Internal notes, @mentions, agent assignment, and team performance tracking.',
    color: 'from-emerald-400 to-green-600',
    glow: 'rgba(52,211,153,0.25)',
    preview: (
      <div className="mt-3 flex items-center gap-1.5">
        {['A', 'B', 'C', 'D'].map((l, i) => (
          <div key={i} className="w-6 h-6 rounded-full bg-gradient-to-br from-slate-500 to-slate-700 border-2 border-[#0d1117] flex items-center justify-center text-[8px] font-bold text-white -ml-1 first:ml-0">
            {l}
          </div>
        ))}
        <span className="text-[9px] text-slate-400 ml-1">+6 agents online</span>
      </div>
    ),
  },
  {
    icon: BookOpen,
    title: 'Canned Responses',
    desc: 'Pre-written reply templates for faster, consistent customer support across your entire team.',
    color: 'from-slate-400 to-slate-600',
    glow: 'rgba(148,163,184,0.2)',
    preview: (
      <div className="mt-3 bg-black/30 rounded-xl p-2.5 border border-white/[0.06] space-y-1">
        {['#greeting → "Hi {name}! How can I help?"', '#pricing → "Here are our plans…"'].map((t) => (
          <p key={t} className="text-[8px] text-slate-500 truncate">{t}</p>
        ))}
      </div>
    ),
  },
  {
    icon: Tag,
    title: 'Contact Segmentation',
    desc: 'Segment contacts by behavior, tags, location, or custom attributes for targeted campaigns.',
    color: 'from-yellow-500 to-amber-600',
    glow: 'rgba(234,179,8,0.25)',
    preview: (
      <div className="mt-3 flex flex-wrap gap-1.5">
        {['VIP', 'Trial', 'Enterprise', 'Churned', 'Hot Lead'].map((tag) => (
          <span key={tag} className="text-[9px] px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 font-medium">{tag}</span>
        ))}
      </div>
    ),
  },
];

export default function Features() {
  return (
    <section id="features" className="py-24 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-slate-950/50 to-transparent pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.05] border border-white/[0.1] text-xs font-semibold text-slate-400 mb-4">
            Everything you need
          </span>
          <h2 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight mb-4">
            All your tools,{' '}
            <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">one platform</span>
          </h2>
          <p className="text-lg text-slate-400 max-w-2xl mx-auto">
            Stop juggling multiple tools. VerzChat combines everything your customer-facing team needs in a single, powerful platform.
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {features.map((feat, i) => (
            <motion.div
              key={feat.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              whileHover={{ y: -4, transition: { duration: 0.2 } }}
              className="group relative bg-white/[0.03] border border-white/[0.07] rounded-2xl p-5 hover:border-white/[0.15] transition-all duration-300 cursor-pointer overflow-hidden"
              style={{ '--glow': feat.glow } as React.CSSProperties}
            >
              {/* Hover glow */}
              <div
                className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                style={{ background: `radial-gradient(ellipse at top left, ${feat.glow}, transparent 60%)` }}
              />

              <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${feat.color} flex items-center justify-center mb-3 shadow-lg`}>
                <feat.icon size={16} className="text-white" strokeWidth={2} />
              </div>

              <h3 className="text-sm font-bold text-white mb-1.5">{feat.title}</h3>
              <p className="text-xs text-slate-500 leading-relaxed">{feat.desc}</p>

              {feat.preview}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
