'use client';
import { motion } from 'framer-motion';

const stats = [
  { value: '50M+', label: 'messages delivered' },
  { value: '10,000+', label: 'businesses worldwide' },
  { value: '99.9%', label: 'uptime in the last year' },
  { value: '< 0.3s', label: 'average delivery time' },
];

export default function TrustBar() {
  return (
    <section className="border-y border-gray-100 bg-gray-50/60 py-10">
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-4">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08, duration: 0.5 }}
              className="text-center lg:text-left lg:border-l lg:border-gray-200 lg:pl-8 first:border-l-0 first:pl-0"
            >
              <p className="text-2xl font-extrabold text-gray-900">{stat.value}</p>
              <p className="text-sm text-gray-400 mt-0.5">{stat.label}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
