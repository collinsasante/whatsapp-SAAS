'use client';
import { motion } from 'framer-motion';
import { ArrowRight, Calendar } from 'lucide-react';
import Link from 'next/link';

export default function BottomCTA() {
  return (
    <section className="py-20 bg-gray-900 relative overflow-hidden">
      <motion.div
        animate={{ scale: [1, 1.3, 1], opacity: [0.1, 0.2, 0.1] }}
        transition={{ repeat: Infinity, duration: 8, ease: 'easeInOut' }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[#25D366]/20 rounded-full blur-3xl pointer-events-none"
      />

      <div className="relative max-w-3xl mx-auto px-5 sm:px-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#25D366]/10 border border-[#25D366]/20 text-[#4ade80] text-xs font-semibold mb-6">
            <motion.div animate={{ scale: [1, 1.4, 1] }} transition={{ repeat: Infinity, duration: 2 }} className="w-1.5 h-1.5 rounded-full bg-[#25D366]" />
            Live in under 20 minutes
          </div>

          <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4 leading-tight">
            Your customers are messaging you right now.
          </h2>
          <p className="text-gray-400 text-lg mb-8 max-w-xl mx-auto">
            Give your team the inbox they deserve. See VerzChat working on real conversations in a 20-minute demo, no slides, no sales pitch.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
              <Link
                href="/auth/register"
                className="flex items-center gap-2 px-6 py-3 bg-[#25D366] hover:bg-[#1aad57] text-white font-semibold rounded-xl transition-colors shadow-sm text-sm w-full sm:w-auto justify-center"
              >
                <Calendar size={15} />
                Book a demo
              </Link>
            </motion.div>
            <motion.a
              whileHover={{ scale: 1.04 }}
              href="mailto:notifications@verzchat.com"
              className="flex items-center gap-2 px-6 py-3 border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 font-semibold rounded-xl transition-colors text-sm w-full sm:w-auto justify-center"
            >
              Send us a message <ArrowRight size={14} />
            </motion.a>
          </div>

          <p className="text-gray-600 text-xs mt-6">No credit card. No sales call. Just the product.</p>
        </motion.div>
      </div>
    </section>
  );
}
