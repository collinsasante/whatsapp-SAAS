'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Minus } from 'lucide-react';

const faqs = [
  {
    q: 'Do I need a WhatsApp Business API account to use VerzChat?',
    a: "Yes, you'll need a WhatsApp Business API account. However, we make this very easy — our onboarding wizard guides you through the full setup with Meta in under 10 minutes. We're an official Meta Business Partner, so approval is streamlined.",
  },
  {
    q: 'How is VerzChat different from WhatsApp Business app?',
    a: 'The WhatsApp Business app is for single users. VerzChat is built for teams — multiple agents can manage conversations simultaneously, you can build chatbots, run broadcast campaigns to thousands, and get deep analytics. Think of it as WhatsApp Business × 100.',
  },
  {
    q: 'Can I migrate from my current platform (Chatwoot, Respond.io, etc.)?',
    a: "Absolutely. We offer free, white-glove migration assistance. This includes importing your contacts, conversation history (where permitted), chatbot flows, and team configurations. Most migrations complete within 24-48 hours.",
  },
  {
    q: 'How does the AI chatbot work? Do I need to code?',
    a: 'Zero coding required. Our visual flow builder lets you drag and drop conversation nodes — greetings, conditions, replies, handoffs. For AI responses, you simply upload your FAQs or knowledge base documents, and our GPT-4-powered engine handles the rest.',
  },
  {
    q: 'Is my customer data secure? Are you GDPR compliant?',
    a: 'Yes, fully. VerzChat is GDPR, CCPA, and SOC 2 Type II compliant. All data is encrypted at rest (AES-256) and in transit (TLS 1.3). We process data in EU regions by default with optional US/APAC data residency. Your data is never used to train our models.',
  },
  {
    q: 'What happens when I reach my conversation limit?',
    a: "We never cut you off mid-conversation. If you're approaching your limit, we'll notify you and help you upgrade seamlessly. On Starter, you can purchase top-up packs. On Growth and above, conversation limits are generous and overages are billed at a fair per-conversation rate.",
  },
  {
    q: 'Can I connect Instagram, Facebook Messenger, and other channels?',
    a: 'Yes. VerzChat supports WhatsApp Business API, Instagram DMs, Facebook Messenger, Telegram, Email (SMTP/IMAP), and web live chat — all in one inbox. More channels are added regularly based on customer demand.',
  },
  {
    q: 'Do you offer a free trial? What\'s included?',
    a: 'Yes — 14 days free, no credit card required. The trial includes full Growth plan features: 3 WhatsApp numbers, AI chatbots, broadcast campaigns, advanced analytics, and priority support. After the trial, you choose a plan or your account downgrades to read-only.',
  },
];

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section className="py-24 relative">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight mb-4">
            Frequently asked{' '}
            <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">questions</span>
          </h2>
          <p className="text-slate-400">Everything you need to know about VerzChat. Can't find your answer? <a href="#" className="text-emerald-400 hover:underline">Talk to us.</a></p>
        </motion.div>

        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 15 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
              className={`bg-white/[0.03] border rounded-xl overflow-hidden transition-colors ${openIndex === i ? 'border-emerald-500/30' : 'border-white/[0.07] hover:border-white/[0.12]'}`}
            >
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="w-full flex items-center justify-between px-5 py-4 text-left"
              >
                <span className={`text-sm font-semibold pr-4 ${openIndex === i ? 'text-white' : 'text-slate-300'}`}>{faq.q}</span>
                <div className={`flex-shrink-0 w-6 h-6 rounded-full border flex items-center justify-center transition-all ${openIndex === i ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' : 'border-white/[0.1] text-slate-500'}`}>
                  {openIndex === i ? <Minus size={12} /> : <Plus size={12} />}
                </div>
              </button>
              <AnimatePresence>
                {openIndex === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <div className="px-5 pb-4 border-t border-white/[0.05]">
                      <p className="text-sm text-slate-400 leading-relaxed pt-3">{faq.a}</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
