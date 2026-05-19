'use client';
import { useState, useEffect, useRef } from 'react';
import { motion, useInView } from 'framer-motion';

const stats = [
  { value: 50, suffix: 'M+', label: 'messages delivered' },
  { value: 10000, suffix: '+', label: 'businesses worldwide', format: true },
  { value: 99.9, suffix: '%', label: 'uptime last 12 months' },
  { value: 0.3, suffix: 's', label: 'avg delivery time', prefix: '<' },
];

function CountUp({ to, suffix, prefix, format, duration = 1800 }: { to: number; suffix: string; prefix?: string; format?: boolean; duration?: number }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });

  useEffect(() => {
    if (!inView) return;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      setCount(to * ease);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [inView, to, duration]);

  const display = to < 1
    ? count.toFixed(1)
    : format
    ? Math.round(count).toLocaleString()
    : Math.round(count).toString();

  return <span ref={ref}>{prefix}{display}{suffix}</span>;
}

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
              <p className="text-2xl font-extrabold text-gray-900">
                <CountUp to={stat.value} suffix={stat.suffix} prefix={stat.prefix} format={stat.format} />
              </p>
              <p className="text-sm text-gray-400 mt-0.5">{stat.label}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
