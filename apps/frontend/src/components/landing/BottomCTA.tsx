'use client';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function BottomCTA() {
  return (
    <section className="py-20 bg-gray-900">
      <div className="max-w-3xl mx-auto px-5 sm:px-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#25D366]/10 border border-[#25D366]/20 text-[#4ade80] text-xs font-semibold mb-6">
            <div className="w-1.5 h-1.5 rounded-full bg-[#25D366] animate-pulse" />
            Up and running in under 20 minutes
          </div>

          <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4 leading-tight">
            Your customers are messaging you right now.
          </h2>
          <p className="text-gray-400 text-lg mb-8 max-w-xl mx-auto">
            Give your team the inbox they need to keep up. Start your free trial, no credit card, no calls, no setup fee.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/auth/register"
              className="flex items-center gap-2 px-6 py-3 bg-[#25D366] hover:bg-[#1aad57] text-white font-semibold rounded-xl transition-colors shadow-sm text-sm w-full sm:w-auto justify-center"
            >
              Start free trial <ArrowRight size={15} />
            </Link>
            <a
              href="mailto:notifications@verzchat.com"
              className="flex items-center gap-2 px-6 py-3 border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 font-semibold rounded-xl transition-colors text-sm w-full sm:w-auto justify-center"
            >
              Email us a question
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
