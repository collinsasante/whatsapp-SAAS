'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Plus, Minus, ArrowUpRight } from 'lucide-react';

export interface FeatureSection {
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
}

export interface FeatureFaq {
  q: string;
  a: string;
}

export interface RelatedLink {
  href: string;
  label: string;
}

export interface FeaturePageProps {
  eyebrow: string;
  title: React.ReactNode;
  lead: string;
  sections: FeatureSection[];
  faqs: FeatureFaq[];
  related: RelatedLink[];
}

function FaqItem({ q, a }: FeatureFaq) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl bg-gray-50 px-6 py-5 transition-all">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-4 text-left text-[16px] font-semibold text-gray-900"
        aria-expanded={open}
      >
        <span>{q}</span>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-teal-600 transition hover:bg-teal-700">
          {open ? <Minus className="size-4 text-white" /> : <Plus className="size-4 text-white" />}
        </span>
      </button>
      <div
        className={`overflow-hidden text-[15px] leading-7 text-gray-500 transition-all duration-300 ${
          open ? 'max-h-[400px] pt-3.5' : 'max-h-0'
        }`}
      >
        {a}
      </div>
    </div>
  );
}

/** Shared visual scaffold for /shared-inbox, /whatsapp-broadcasts, /whatsapp-crm, /whatsapp-chatbot. */
export default function FeaturePage({ eyebrow, title, lead, sections, faqs, related }: FeaturePageProps) {
  return (
    <main className="min-h-screen bg-white pt-36 pb-16 space-y-6">
      {/* Hero */}
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <div className="rounded-[2.25rem] px-8 py-12 md:px-14 md:py-16 text-center">
          <p className="mb-4 inline-block rounded-full border border-teal-200 bg-teal-50 px-4 py-1.5 text-[13px] font-semibold uppercase tracking-widest text-teal-700">
            {eyebrow}
          </p>
          <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 md:text-6xl lg:text-[4.5rem] leading-[1.05]">
            {title}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-[15px] leading-7 text-gray-500">{lead}</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/auth/register"
              className="inline-flex h-12 items-center rounded-full bg-teal-600 px-7 text-sm font-extrabold text-white shadow-[0_14px_34px_rgba(13,148,136,0.25)] transition hover:bg-teal-700"
            >
              Get Started Free
            </Link>
            <Link
              href="/book-demo"
              className="inline-flex h-12 items-center rounded-full border-2 border-gray-200 px-7 text-sm font-bold text-gray-700 transition hover:border-teal-300 hover:text-teal-700"
            >
              Book a Demo
            </Link>
          </div>
        </div>
      </div>

      {/* Benefit sections */}
      {sections.map((sec) => (
        <section key={sec.title} className="mx-auto max-w-6xl px-5 md:px-8">
          <div className="rounded-[2.25rem] bg-white px-8 py-9 md:px-12 md:py-12 lg:px-14 lg:py-14 border border-gray-100">
            <div className="grid gap-12 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-16">
              <div className="max-w-[280px]">
                <span className="mb-3 inline-block text-[13px] font-bold uppercase tracking-widest text-teal-600">
                  {sec.eyebrow}
                </span>
                <h2 className="text-[2rem] font-extrabold leading-[1.1] tracking-tight text-gray-900">{sec.title}</h2>
                <p className="mt-5 text-[15px] leading-7 text-gray-500">{sec.body}</p>
              </div>
              <ul className="space-y-3 self-center">
                {sec.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-3 text-[15px] leading-6 text-gray-700">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-teal-100 text-[11px] font-bold text-teal-700">✓</span>
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ))}

      {/* FAQ */}
      {faqs.length > 0 && (
        <section className="mx-auto max-w-6xl px-5 md:px-8">
          <div className="rounded-[2.25rem] bg-white px-8 py-9 md:px-12 md:py-12 lg:px-14 lg:py-14 border border-gray-100">
            <div className="grid gap-12 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-16">
              <div className="max-w-[280px]">
                <h2 className="text-[2rem] font-extrabold leading-[1.1] tracking-tight text-gray-900">
                  Frequently asked questions
                </h2>
              </div>
              <div className="space-y-4">
                {faqs.map((faq) => (
                  <FaqItem key={faq.q} {...faq} />
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Related links */}
      {related.length > 0 && (
        <section className="mx-auto max-w-6xl px-5 md:px-8">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-gray-100 pt-8">
            <span className="text-[13px] font-bold uppercase tracking-widest text-gray-400">Related</span>
            {related.map((r) => (
              <Link
                key={r.href}
                href={r.href}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-600 transition hover:text-teal-700"
              >
                {r.label}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* CTA strip */}
      <div className="mx-auto max-w-6xl px-5 md:px-8 pb-8">
        <div className="rounded-[2.25rem] bg-teal-600 px-8 py-10 md:px-14 md:py-12 flex flex-col items-center text-center gap-5 sm:flex-row sm:justify-between sm:text-left">
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-widest text-teal-200">Ready to try it?</p>
            <h3 className="mt-1 text-2xl font-extrabold tracking-tight text-white md:text-3xl">
              Live in under 20 minutes.
            </h3>
            <p className="mt-2 text-[15px] text-white/70 max-w-sm">
              Free to start. No credit card required, no code required.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:shrink-0">
            <Link
              href="/auth/register"
              className="inline-flex items-center justify-center rounded-2xl bg-white px-7 py-3.5 text-[15px] font-semibold text-teal-700 transition hover:bg-teal-50"
            >
              Get Started Free
            </Link>
            <Link
              href="/book-demo"
              className="inline-flex items-center justify-center rounded-2xl border-2 border-white/40 bg-transparent px-7 py-3.5 text-[15px] font-semibold text-white transition hover:bg-white/10"
            >
              Book a Demo
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
