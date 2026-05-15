'use client';
import { Sparkles, Bot, BarChart2, MessageSquare, Clock } from 'lucide-react';

export default function AiPendingPage() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-purple-50 via-white to-indigo-50 p-8">
      <div className="max-w-lg w-full text-center">
        {/* Icon */}
        <div className="w-20 h-20 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-purple-200">
          <Sparkles size={36} className="text-white" />
        </div>

        {/* Badge */}
        <span className="inline-flex items-center gap-1.5 bg-purple-100 text-purple-700 text-xs font-semibold px-3 py-1 rounded-full mb-4">
          <Clock size={11} /> Coming Soon
        </span>

        <h1 className="text-2xl font-bold text-gray-900 mb-3">AI Conversation Summaries</h1>
        <p className="text-gray-500 text-sm leading-relaxed mb-8">
          Get instant AI-powered insights for every customer conversation — topic detection, sentiment analysis, action items, and resolution summaries — all in one place.
        </p>

        {/* Feature cards */}
        <div className="grid grid-cols-1 gap-3 text-left">
          {[
            { icon: MessageSquare, title: 'Conversation Digest', desc: 'Auto-summarise what each customer asked and how it was resolved.' },
            { icon: Bot, title: 'Topic & Intent Detection', desc: 'Automatically categorise conversations by topic, urgency, and customer intent.' },
            { icon: BarChart2, title: 'Sentiment Trends', desc: 'Track customer sentiment over time and catch recurring pain points before they escalate.' },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex items-start gap-3 bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
              <div className="w-8 h-8 bg-purple-50 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                <Icon size={15} className="text-purple-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">{title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-8 text-xs text-gray-400">
          In the meantime, use the <span className="font-medium text-purple-600">✨ summarise button</span> inside any conversation to get an instant AI summary.
        </p>
      </div>
    </div>
  );
}
