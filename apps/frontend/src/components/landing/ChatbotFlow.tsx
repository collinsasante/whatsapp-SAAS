'use client';
import { motion } from 'framer-motion';
import { Bot, GitBranch, MessageSquare, Zap, CheckCircle2, ArrowRight } from 'lucide-react';

const nodes = [
  { id: 'start', x: 30, y: 160, type: 'trigger', label: 'New Message', sublabel: 'WhatsApp trigger', icon: MessageSquare, color: 'border-emerald-500/50 bg-emerald-500/10', dot: 'bg-emerald-500', iconColor: 'text-emerald-400' },
  { id: 'greet', x: 175, y: 80, type: 'message', label: 'Send Greeting', sublabel: 'Welcome message', icon: Bot, color: 'border-blue-500/50 bg-blue-500/10', dot: 'bg-blue-500', iconColor: 'text-blue-400' },
  { id: 'check', x: 175, y: 230, type: 'condition', label: 'Keywords Match?', sublabel: 'price / order / help', icon: GitBranch, color: 'border-violet-500/50 bg-violet-500/10', dot: 'bg-violet-500', iconColor: 'text-violet-400' },
  { id: 'reply', x: 320, y: 100, type: 'message', label: 'Auto Reply', sublabel: 'Template response', icon: Zap, color: 'border-teal-500/50 bg-teal-500/10', dot: 'bg-teal-500', iconColor: 'text-teal-400' },
  { id: 'assign', x: 320, y: 250, type: 'action', label: 'Assign to Agent', sublabel: 'Human handoff', icon: CheckCircle2, color: 'border-orange-500/50 bg-orange-500/10', dot: 'bg-orange-500', iconColor: 'text-orange-400' },
  { id: 'end', x: 450, y: 160, type: 'end', label: 'Resolved ✓', sublabel: 'Close conversation', icon: CheckCircle2, color: 'border-emerald-500/50 bg-emerald-500/10', dot: 'bg-emerald-500', iconColor: 'text-emerald-400' },
];

const edges = [
  { from: 'start', to: 'greet', label: '' },
  { from: 'start', to: 'check', label: '' },
  { from: 'check', to: 'reply', label: 'Yes' },
  { from: 'check', to: 'assign', label: 'No' },
  { from: 'reply', to: 'end', label: '' },
  { from: 'assign', to: 'end', label: '' },
];

function getNodeCenter(id: string) {
  const n = nodes.find((n) => n.id === id);
  if (!n) return { x: 0, y: 0 };
  return { x: n.x + 55, y: n.y + 28 };
}

export default function ChatbotFlow() {
  return (
    <section className="py-24 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(139,92,246,0.05)_0%,transparent_70%)]" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="order-2 lg:order-1"
          >
            {/* Flow canvas */}
            <div className="relative bg-[#0a0f1a] border border-white/[0.08] rounded-2xl overflow-hidden shadow-2xl" style={{ height: 340 }}>
              {/* Grid bg */}
              <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)', backgroundSize: '24px 24px' }} />

              {/* Title bar */}
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.06] bg-[#0d1117]/60 backdrop-blur-sm">
                <div className="w-2 h-2 rounded-full bg-red-500/70" />
                <div className="w-2 h-2 rounded-full bg-yellow-500/70" />
                <div className="w-2 h-2 rounded-full bg-emerald-500/70" />
                <span className="text-[10px] text-slate-500 ml-2">Chatbot Flow Builder — Order Support</span>
                <div className="ml-auto flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[9px] text-emerald-400 font-medium">Active</span>
                </div>
              </div>

              {/* Flow SVG */}
              <div className="relative" style={{ height: 296 }}>
                <svg className="absolute inset-0 w-full h-full pointer-events-none">
                  {edges.map((edge, i) => {
                    const from = getNodeCenter(edge.from);
                    const to = getNodeCenter(edge.to);
                    const midX = (from.x + to.x) / 2;
                    const path = `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;
                    return (
                      <g key={i}>
                        <motion.path
                          d={path}
                          stroke="rgba(16,185,129,0.25)"
                          strokeWidth="1.5"
                          fill="none"
                          strokeDasharray="4 4"
                          initial={{ pathLength: 0 }}
                          whileInView={{ pathLength: 1 }}
                          viewport={{ once: true }}
                          transition={{ delay: i * 0.15, duration: 0.6 }}
                        />
                        {edge.label && (
                          <text x={midX - 8} y={(from.y + to.y) / 2 - 4} fill="rgba(148,163,184,0.8)" fontSize="8" fontWeight="600">
                            {edge.label}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>

                {nodes.map((node, i) => (
                  <motion.div
                    key={node.id}
                    initial={{ opacity: 0, scale: 0.8 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.1, duration: 0.4 }}
                    className="absolute"
                    style={{ left: node.x, top: node.y }}
                  >
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${node.color} backdrop-blur-sm min-w-[110px] cursor-pointer hover:scale-105 transition-transform`}>
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${node.dot}`} />
                      <div>
                        <p className={`text-[9px] font-bold ${node.iconColor}`}>{node.label}</p>
                        <p className="text-[8px] text-slate-600">{node.sublabel}</p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Stats below flow */}
            <div className="grid grid-cols-3 gap-3 mt-4">
              {[
                { label: 'Automation Rate', value: '82%', color: 'text-violet-400' },
                { label: 'Avg Response', value: '0.3s', color: 'text-emerald-400' },
                { label: 'Resolved by Bot', value: '1,247', color: 'text-blue-400' },
              ].map((s) => (
                <div key={s.label} className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-3 text-center">
                  <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Right */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="order-1 lg:order-2"
          >
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-xs font-semibold text-violet-400 mb-4">
              <Bot size={11} />
              AI Chatbot Builder
            </span>
            <h2 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight mb-5 leading-tight">
              Build flows,{' '}
              <span className="bg-gradient-to-r from-violet-400 to-purple-300 bg-clip-text text-transparent">not code</span>
            </h2>
            <p className="text-lg text-slate-400 leading-relaxed mb-8">
              Drag, drop, and connect. Our visual flow builder lets you create powerful chatbot automations in minutes — no developer needed.
            </p>

            <div className="space-y-3">
              {[
                { icon: GitBranch, title: 'Visual no-code builder', desc: 'Drag-and-drop nodes to build complex conversation flows with conditions and branching.', color: 'text-violet-400 bg-violet-500/10 border-violet-500/20' },
                { icon: Zap, title: 'AI-powered responses', desc: 'Train the bot on your knowledge base. GPT-4 handles nuanced questions automatically.', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
                { icon: ArrowRight, title: 'Seamless human handoff', desc: 'Bot detects when it can\'t help and smoothly escalates to the right agent instantly.', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
              ].map((item) => (
                <div key={item.title} className="flex items-start gap-3 p-4 bg-white/[0.03] border border-white/[0.07] rounded-xl hover:border-violet-500/30 transition-colors">
                  <div className={`w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0 ${item.color}`}>
                    <item.icon size={14} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{item.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
