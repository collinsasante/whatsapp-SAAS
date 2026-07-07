"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Minus } from "lucide-react";
import {
  GETTING_STARTED_FAQS,
  INBOX_FEATURES_FAQS,
  PRICING_SECURITY_FAQS,
} from "./faq-data";

// ─── Sub-components ───────────────────────────────────────────────────────────

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl bg-gray-50 px-6 py-5 transition-all">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-4 text-left text-[16px] font-semibold text-gray-900 transition-colors"
        aria-expanded={open}
      >
        <span>{q}</span>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-teal-600 transition hover:bg-teal-700">
          {open ? (
            <Minus className="size-4 text-white" />
          ) : (
            <Plus className="size-4 text-white" />
          )}
        </span>
      </button>
      <div
        className={`overflow-hidden text-[15px] leading-7 text-gray-500 transition-all duration-300 ${
          open ? "max-h-[400px] pt-3.5" : "max-h-0"
        }`}
      >
        {a}
      </div>
    </div>
  );
}

function FaqSection({ title, description, faqs }) {
  return (
    <section className="mx-auto max-w-6xl px-5 md:px-8">
      <div className="rounded-[2.25rem] bg-white px-8 py-9 md:px-12 md:py-12 lg:px-14 lg:py-14">
        <div className="grid gap-12 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-16">
          <div className="max-w-[280px]">
            <h2 className="text-[2.4rem] font-extrabold leading-[1.05] tracking-tight text-gray-900 md:text-5xl">
              {title}
            </h2>
            <p className="mt-5 text-[15px] leading-7 text-gray-500">
              {description}
            </p>
          </div>
          <div className="space-y-4">
            {faqs.map((faq) => (
              <FaqItem key={faq.q} q={faq.q} a={faq.a} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FaqPage() {
  return (
    <main className="min-h-screen bg-white py-16 space-y-6 pt-36">

      {/* ── Hero ── */}
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <div className="rounded-[2.25rem] px-8 py-12 md:px-14 md:py-16 text-center">
          <p className="mb-4 inline-block rounded-full border border-teal-200 bg-teal-50 px-4 py-1.5 text-[13px] font-semibold uppercase tracking-widest text-teal-700">
            Help Center
          </p>
          <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 md:text-6xl lg:text-[4.5rem] leading-[1.05]">
            Frequently Asked
            <br />
            <span className="text-teal-600">Questions</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-[15px] leading-7 text-gray-500">
            Everything you need to know about setting up VerzChat, managing your
            team inbox, and connecting WhatsApp, Instagram, Facebook, Telegram,
            and TikTok in one place.
          </p>
        </div>
      </div>

      {/* ── Getting Started ── */}
      <FaqSection
        title="Getting Started"
        description="How to connect your channels, onboard your team, and go live in under 20 minutes."
        faqs={GETTING_STARTED_FAQS}
      />

      {/* ── Inbox & Features ── */}
      <FaqSection
        title="Inbox & Features"
        description="How the shared inbox, assignments, broadcasts, automation, and AI tools work for your team."
        faqs={INBOX_FEATURES_FAQS}
      />

      {/* ── Pricing & Security ── */}
      <FaqSection
        title="Pricing & Security"
        description="Transparent answers about billing, data protection, and compliance."
        faqs={PRICING_SECURITY_FAQS}
      />

      {/* ── CTA strip ── */}
      <div className="mx-auto max-w-6xl px-5 md:px-8 pb-8">
        <div className="rounded-[2.25rem] bg-teal-600 px-8 py-10 md:px-14 md:py-12 flex flex-col items-center text-center gap-5 sm:flex-row sm:justify-between sm:text-left">
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-widest text-teal-200">
              Still have questions?
            </p>
            <h3 className="mt-1 text-2xl font-extrabold tracking-tight text-white md:text-3xl">
              We&apos;re here to help.
            </h3>
            <p className="mt-2 text-[15px] text-white/70 max-w-sm">
              Reach out to the VerzChat team for onboarding support, channel
              setup guidance, or anything else on your mind.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:shrink-0">
            <Link
              href="/contact-us"
              className="inline-flex items-center justify-center rounded-2xl bg-white px-7 py-3.5 text-[15px] font-semibold text-teal-700 transition hover:bg-teal-50"
            >
              Contact Support
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
