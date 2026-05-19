'use client';
import type { Metadata } from 'next';
import { CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { motion } from 'framer-motion';

const systems = [
  { name: 'Inbox & Messaging', status: 'operational', latency: '38ms' },
  { name: 'WhatsApp API Delivery', status: 'operational', latency: '280ms' },
  { name: 'Chatbot & Automation', status: 'operational', latency: '45ms' },
  { name: 'Verz AI Suggestions', status: 'operational', latency: '1.2s' },
  { name: 'Broadcast Campaigns', status: 'operational', latency: '120ms' },
  { name: 'File & Media Uploads', status: 'operational', latency: '310ms' },
  { name: 'Realtime Notifications', status: 'operational', latency: '22ms' },
  { name: 'API Webhooks', status: 'operational', latency: '55ms' },
];

const incidents: { date: string; title: string; detail: string; resolved: boolean }[] = [];

const uptime = [
  { month: 'Dec', pct: 100 }, { month: 'Jan', pct: 100 }, { month: 'Feb', pct: 99.97 },
  { month: 'Mar', pct: 100 }, { month: 'Apr', pct: 99.99 }, { month: 'May', pct: 100 },
];

export default function StatusPage() {
  const allGood = systems.every((s) => s.status === 'operational');

  return (
    <div className="max-w-3xl mx-auto px-5 sm:px-8 py-16">
      <div className="mb-10">
        <h1 className="text-4xl font-extrabold text-gray-900 mb-4">System Status</h1>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`flex items-center gap-3 p-4 rounded-2xl border-2 ${allGood ? 'bg-[#f0fdf4] border-[#bbf7d0]' : 'bg-red-50 border-red-200'}`}
        >
          {allGood
            ? <CheckCircle2 size={22} className="text-[#25D366] flex-shrink-0" />
            : <AlertCircle size={22} className="text-red-500 flex-shrink-0" />}
          <div>
            <p className={`font-bold text-base ${allGood ? 'text-[#15803d]' : 'text-red-700'}`}>
              {allGood ? 'All systems operational' : 'Some systems are experiencing issues'}
            </p>
            <p className="text-sm text-gray-500 mt-0.5">
              Updated: {new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        </motion.div>
      </div>

      <section className="mb-12">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Components</h2>
        <div className="border border-gray-200 rounded-2xl overflow-hidden divide-y divide-gray-100">
          {systems.map((s, i) => (
            <motion.div key={s.name} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}
              className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3">
                <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ repeat: Infinity, duration: 2.5, delay: i * 0.3 }}
                  className="w-2 h-2 rounded-full bg-[#25D366] flex-shrink-0" />
                <span className="text-sm font-medium text-gray-800">{s.name}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-gray-400 hidden sm:block">{s.latency}</span>
                <span className="text-xs font-semibold text-[#15803d] bg-[#f0fdf4] px-2.5 py-0.5 rounded-full">Operational</span>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Uptime — last 6 months</h2>
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
          <div className="grid grid-cols-6 gap-3">
            {uptime.map((u) => (
              <div key={u.month} className="text-center">
                <div className="h-16 flex items-end justify-center mb-2">
                  <div
                    className="w-full rounded-t-md"
                    style={{ height: `${u.pct}%`, backgroundColor: u.pct >= 99.95 ? '#25D366' : u.pct >= 99 ? '#fbbf24' : '#ef4444' }}
                  />
                </div>
                <p className="text-[11px] font-semibold text-gray-600">{u.month}</p>
                <p className="text-[10px] text-gray-400">{u.pct}%</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-4 text-center">Rolling 6-month average: 99.99%</p>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-4">Incident history</h2>
        {incidents.length === 0 ? (
          <div className="flex items-center gap-3 p-5 bg-gray-50 border border-gray-200 rounded-2xl">
            <Clock size={18} className="text-gray-400 flex-shrink-0" />
            <p className="text-sm text-gray-500">No incidents in the last 90 days. The boring kind of quiet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {incidents.map((inc) => (
              <div key={inc.title} className="p-5 border border-gray-200 rounded-2xl">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">{inc.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{inc.date}</p>
                    <p className="text-sm text-gray-600 mt-2">{inc.detail}</p>
                  </div>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 ${inc.resolved ? 'bg-[#f0fdf4] text-[#15803d]' : 'bg-red-50 text-red-600'}`}>
                    {inc.resolved ? 'Resolved' : 'Ongoing'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="mt-10 pt-8 border-t border-gray-100">
        <p className="text-sm text-gray-400">
          Get status updates by email: <a href="mailto:notifications@verzchat.com" className="text-teal-700 underline">notifications@verzchat.com</a>
        </p>
      </div>
    </div>
  );
}
