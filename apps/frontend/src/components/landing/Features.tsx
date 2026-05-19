'use client';
import { motion } from 'framer-motion';

const features = [
  {
    number: '01',
    title: 'Stop assigning conversations over Slack.',
    desc: 'When a message comes in, your team sees it and claims it. Assign to the right agent, add internal notes, and resolve without stepping on each other. No more "who\'s handling this?"',
    pills: ['Agent assignment', 'Private notes', 'Conversation labels', 'Team visibility'],
    mockup: (
      <div className="rounded-xl border border-gray-200 overflow-hidden shadow-sm bg-white">
        <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2">
          <div className="text-[10px] font-semibold text-gray-500">Active conversations · 24 open</div>
          <div className="ml-auto text-[9px] px-2 py-0.5 bg-[#f0fdf4] text-[#15803d] border border-[#bbf7d0] rounded-full font-semibold">All agents</div>
        </div>
        {[
          { name: 'Sarah K.', agent: 'Alice', status: 'Replied', color: 'bg-violet-500', dot: 'bg-[#25D366]' },
          { name: 'Tech Corp', agent: 'Unassigned', status: 'Waiting', color: 'bg-blue-500', dot: 'bg-orange-400' },
          { name: 'Ahmed H.', agent: 'Bob', status: 'Resolved', color: 'bg-emerald-500', dot: 'bg-gray-300' },
        ].map((row) => (
          <div key={row.name} className="flex items-center gap-2.5 px-3 py-2 border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
            <div className={`w-6 h-6 rounded-full ${row.color} flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0`}>{row.name[0]}</div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-gray-800">{row.name}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${row.dot}`} />
              <span className="text-[9px] text-gray-500">{row.agent}</span>
            </div>
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
              row.status === 'Replied' ? 'bg-[#f0fdf4] text-[#15803d]' :
              row.status === 'Waiting' ? 'bg-orange-50 text-orange-600' :
              'bg-gray-100 text-gray-500'
            }`}>{row.status}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    number: '02',
    title: 'Reply to 10,000 customers without typing each one.',
    desc: 'Build a WhatsApp broadcast campaign in minutes. Upload your contact list, pick a template, and send. Track who got it, who read it, and who clicked, in real time.',
    pills: ['Broadcast campaigns', 'Delivery tracking', 'Read & click rates', 'Contact segments'],
    mockup: (
      <div className="rounded-xl border border-gray-200 overflow-hidden shadow-sm bg-white">
        <div className="px-3 py-2.5 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold text-gray-800">Summer Sale Campaign</p>
            <span className="text-[9px] px-1.5 py-0.5 bg-[#f0fdf4] text-[#15803d] border border-[#bbf7d0] rounded-full font-bold">Sent</span>
          </div>
          <p className="text-[10px] text-gray-400 mt-0.5">12,450 recipients · WhatsApp</p>
        </div>
        <div className="px-3 py-2.5 grid grid-cols-3 gap-2">
          {[
            { label: 'Delivered', value: '98.2%', color: 'text-[#15803d] bg-[#f0fdf4]' },
            { label: 'Read', value: '67.4%', color: 'text-blue-700 bg-blue-50' },
            { label: 'Clicked', value: '12.1%', color: 'text-orange-700 bg-orange-50' },
          ].map((s) => (
            <div key={s.label} className={`rounded-lg p-2 text-center ${s.color}`}>
              <p className="text-base font-extrabold">{s.value}</p>
              <p className="text-[9px] font-medium opacity-80">{s.label}</p>
            </div>
          ))}
        </div>
        <div className="px-3 pb-2.5">
          <div className="flex items-end gap-0.5 h-8">
            {[55, 70, 65, 82, 78, 91, 88, 98].map((h, i) => (
              <div key={i} className="flex-1 bg-[#25D366]/20 rounded-sm" style={{ height: `${h}%` }} />
            ))}
          </div>
          <p className="text-[8px] text-gray-300 mt-1 text-center">Delivery rate over time</p>
        </div>
      </div>
    ),
  },
  {
    number: '03',
    title: 'Let the bot handle FAQs. You handle the rest.',
    desc: 'Build chatbot flows with drag-and-drop, no code. Set triggers, define responses, and the bot handles common questions 24/7. When it can\'t help, it hands off to a live agent instantly.',
    pills: ['No-code flow builder', 'AI-powered replies', 'Live agent handoff', '24/7 automation'],
    mockup: (
      <div className="rounded-xl border border-gray-200 overflow-hidden shadow-sm bg-white">
        <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
          <p className="text-[10px] font-semibold text-gray-500">Chatbot · Order Support</p>
          <span className="text-[9px] text-[#15803d] font-bold">82% handled by bot</span>
        </div>
        <div className="p-3 space-y-1.5">
          {[
            { label: 'Trigger', text: 'New message received', color: 'bg-[#f0fdf4] border-[#bbf7d0] text-[#15803d]' },
            { label: 'Check', text: 'Contains "order" or "track"', color: 'bg-violet-50 border-violet-200 text-violet-700' },
            { label: 'Reply', text: 'Send order status template', color: 'bg-blue-50 border-blue-200 text-blue-700' },
            { label: 'Wait', text: '2 minutes · no response?', color: 'bg-orange-50 border-orange-200 text-orange-700' },
            { label: 'Assign', text: 'Route to Support team', color: 'bg-gray-50 border-gray-200 text-gray-600' },
          ].map((node, i) => (
            <div key={i} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[9px] font-medium ${node.color}`}>
              <span className="font-bold uppercase text-[8px] opacity-60 w-10 flex-shrink-0">{node.label}</span>
              <span>{node.text}</span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    number: '04',
    title: 'Know exactly where your team stands.',
    desc: "See how fast your team responds, how many conversations they\'re closing, and what your customers actually think. Updated live, not every Monday morning.",
    pills: ['Response time tracking', 'CSAT scores', 'Agent performance', 'Live dashboards'],
    mockup: (
      <div className="rounded-xl border border-gray-200 overflow-hidden shadow-sm bg-white">
        <div className="px-3 py-2.5 border-b border-gray-100">
          <p className="text-[10px] font-semibold text-gray-500">Team Performance · Today</p>
        </div>
        <div className="px-3 pt-2.5 pb-1 grid grid-cols-2 gap-2">
          {[
            { label: 'Avg response', value: '1m 24s', trend: '↓ 18%', good: true },
            { label: 'CSAT', value: '4.8 / 5', trend: '↑ 0.3', good: true },
            { label: 'Resolved today', value: '142', trend: '↑ 12%', good: true },
            { label: 'Overdue', value: '3', trend: '↓ from 11', good: true },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-gray-50 rounded-lg p-2.5">
              <p className="text-[9px] text-gray-400 mb-0.5">{kpi.label}</p>
              <p className="text-base font-extrabold text-gray-900 leading-none">{kpi.value}</p>
              <p className={`text-[9px] font-semibold mt-0.5 ${kpi.good ? 'text-[#15803d]' : 'text-red-600'}`}>{kpi.trend}</p>
            </div>
          ))}
        </div>
        <div className="px-3 pb-2.5">
          <div className="flex items-end gap-0.5 h-10 mt-1">
            {[42, 58, 52, 74, 68, 82, 76].map((h, i) => (
              <div key={i} className="flex-1 rounded-sm" style={{ height: `${h}%`, backgroundColor: i === 5 ? '#25D366' : '#e5e7eb' }} />
            ))}
          </div>
        </div>
      </div>
    ),
  },
];

export default function Features() {
  return (
    <section id="features" className="py-20 bg-gray-50/40">
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55 }}
          className="mb-14"
        >
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 tracking-tight mb-3">
            Everything your team needs to do the job.
          </h2>
          <p className="text-lg text-gray-500">No bloat. No onboarding workshop. Just the tools that matter.</p>
        </motion.div>

        <div className="space-y-16">
          {features.map((feat, i) => (
            <motion.div
              key={feat.number}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className={`grid lg:grid-cols-2 gap-10 items-center ${i % 2 === 1 ? 'lg:[&>*:first-child]:order-2' : ''}`}
            >
              {/* Text */}
              <div>
                <span className="text-5xl font-black text-gray-100 leading-none select-none">{feat.number}</span>
                <h3 className="text-2xl font-bold text-gray-900 mt-1 mb-3 leading-snug">{feat.title}</h3>
                <p className="text-base text-gray-500 leading-relaxed mb-5">{feat.desc}</p>
                <div className="flex flex-wrap gap-2">
                  {feat.pills.map((pill) => (
                    <span key={pill} className="text-xs font-semibold text-[#15803d] bg-[#f0fdf4] border border-[#bbf7d0] px-3 py-1 rounded-full">
                      {pill}
                    </span>
                  ))}
                </div>
              </div>

              {/* Mockup */}
              <div className="relative">
                {feat.mockup}
                {/* Subtle shadow on the container for depth */}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
