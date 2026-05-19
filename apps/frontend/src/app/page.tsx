import Navbar from '@/components/landing/Navbar';
import Hero from '@/components/landing/Hero';
import Features from '@/components/landing/Features';
import AISection from '@/components/landing/AISection';
import Timeline from '@/components/landing/Timeline';
import Pricing from '@/components/landing/Pricing';
import Footer from '@/components/landing/Footer';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export const metadata = {
  title: 'VerzChat — AI Customer Support That Feels Human',
  description:
    'VerzChat trains on your real conversations and responds across WhatsApp, Instagram, and Messenger with empathy and personalization — at AI scale.',
};

export default function LandingPage() {
  return (
    <div className="bg-[#020917] text-white overflow-x-hidden">
      <Navbar />
      <Hero />
      <Features />
      <AISection />
      <Timeline />
      <Pricing />

      {/* CTA band */}
      <section className="py-24 relative overflow-hidden" style={{ background: '#020917' }}>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_50%,rgba(20,184,166,0.12)_0%,transparent_65%)] pointer-events-none" />
        <div className="relative max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-4xl sm:text-5xl font-extrabold text-white mb-5 tracking-tight">
            Ready to build an AI that{' '}
            <span className="bg-gradient-to-r from-teal-400 to-emerald-400 bg-clip-text text-transparent">
              knows your business?
            </span>
          </h2>
          <p className="text-slate-400 text-lg mb-8">
            Start your 14-day free trial — no credit card needed. Your AI starts learning from day one.
          </p>
          <Link
            href="/register"
            className="inline-flex items-center gap-2 px-8 py-4 bg-teal-500 hover:bg-teal-400 text-white font-bold rounded-xl transition-all duration-200 text-base shadow-2xl shadow-teal-500/30 hover:shadow-teal-500/50 hover:-translate-y-px"
          >
            Start free trial
            <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}
