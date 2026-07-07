'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { XIcon, InstagramIcon, FacebookIcon } from '@/components/BrandIcons';
import {
  ArrowUpRight,
  CheckCircle,
  Clock,
  Loader2,
  Mail,
  MapPin,
  Send,
} from 'lucide-react';
import { motion } from 'framer-motion';

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1';

const initialFormData = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  subject: '',
  message: '',
};

const socialLinks = [
  { icon: <XIcon className="h-5 w-5" />, name: 'X (Twitter)', url: 'https://twitter.com/verzchat' },
  { icon: <InstagramIcon className="h-5 w-5" />, name: 'Instagram', url: 'https://www.instagram.com/verzchat' },
  { icon: <FacebookIcon className="h-5 w-5" />, name: 'Facebook', url: 'https://facebook.com/verzchat' },
];

type FieldProps = React.InputHTMLAttributes<HTMLInputElement | HTMLTextAreaElement> & {
  as?: 'input' | 'textarea';
  className?: string;
  rows?: number;
};

function Field({ as = 'input', className = '', ...props }: FieldProps) {
  const Component = as as React.ElementType;
  return (
    <Component
      className={`w-full rounded-xl border border-gray-200 bg-gray-50 px-5 py-4 text-[15px] font-medium text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-500/10 ${className}`}
      {...props}
    />
  );
}

export default function ContactUsPage() {
  const [formData, setFormData] = useState(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setIsSubmitting(true);

    const fullName = [formData.firstName, formData.lastName].filter(Boolean).join(' ');

    try {
      const response = await fetch(`${API_BASE}/support/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          name: fullName,
          message: [
            formData.subject ? `Subject: ${formData.subject}` : '',
            formData.phone ? `Phone: ${formData.phone}` : '',
            formData.message,
          ]
            .filter(Boolean)
            .join('\n\n'),
        }),
      });

      const result = await response.json();

      if (!response.ok || result.success !== true) {
        throw new Error(result?.error ?? result?.message ?? 'Failed to send message. Please try again.');
      }

      setIsSubmitted(true);
      setFormData(initialFormData);
    } catch (error) {
      const err = error as Error;
      setErrorMessage(err.message ?? 'Failed to send message. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <main className="relative overflow-hidden pt-28">

        <div className="relative mx-auto grid min-h-[calc(100vh-7rem)] w-[min(1160px,calc(100%-40px))] grid-cols-1 items-center gap-12 py-16 lg:grid-cols-[1.05fr_0.75fr] lg:gap-16">

          {/* ── Left: form ── */}
          <motion.section
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
          >
            <div className="mb-7 flex items-center gap-3 text-sm font-bold text-teal-600">
              <span className="h-[2px] w-7 rounded-full bg-teal-500" />
              Contact Us
            </div>

            <h1 className="max-w-[620px] text-[clamp(40px,6vw,72px)] font-semibold leading-[0.96] tracking-[-0.065em] text-gray-900">
              Get in touch<br />with our team
            </h1>

            <p className="mt-5 max-w-[480px] text-[15px] leading-relaxed text-gray-500">
              Have a question about pricing, channels, or your account? Send us a message and we'll get back to you within 24 hours.
            </p>

            {isSubmitted ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mt-12 max-w-[560px] rounded-2xl border border-teal-100 bg-teal-50 p-8"
              >
                <div className="mb-6 grid h-14 w-14 place-items-center rounded-full bg-teal-600 text-white">
                  <CheckCircle className="h-7 w-7" />
                </div>
                <h2 className="text-2xl font-semibold tracking-[-0.03em] text-gray-900">Message sent!</h2>
                <p className="mt-3 text-gray-500">
                  Thanks for reaching out. We'll reply to your email within 24 hours on business days.
                </p>
                <button
                  onClick={() => { setIsSubmitted(false); setErrorMessage(''); }}
                  className="mt-7 h-12 rounded-full bg-teal-600 px-6 text-sm font-bold text-white transition hover:bg-teal-700"
                >
                  Send another message
                </button>
              </motion.div>
            ) : (
              <form onSubmit={handleSubmit} className="mt-10 max-w-[640px]">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleChange}
                    placeholder="First Name *"
                    required
                  />
                  <Field
                    name="lastName"
                    value={formData.lastName}
                    onChange={handleChange}
                    placeholder="Last Name *"
                    required
                  />
                  <Field
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    placeholder="Email *"
                    required
                  />
                  <Field
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    placeholder="Phone Number (optional)"
                  />
                  <Field
                    name="subject"
                    value={formData.subject}
                    onChange={handleChange}
                    placeholder="Subject *"
                    className="sm:col-span-2"
                    required
                  />
                  <Field
                    as="textarea"
                    name="message"
                    value={formData.message}
                    onChange={handleChange}
                    placeholder="Message *"
                    rows={6}
                    className="min-h-[170px] resize-none sm:col-span-2"
                    required
                  />
                </div>

                {errorMessage && (
                  <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {errorMessage}
                  </div>
                )}

                <div className="mt-8 flex items-center gap-4">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex h-12 items-center gap-2 rounded-full bg-teal-600 px-7 text-sm font-extrabold text-white shadow-[0_14px_34px_rgba(13,148,136,0.25)] transition hover:bg-teal-700 disabled:opacity-60"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Sending…
                      </>
                    ) : (
                      'Send Message'
                    )}
                  </button>
                  <span className="grid h-12 w-12 place-items-center rounded-full bg-teal-50 text-teal-600">
                    <ArrowUpRight className="h-5 w-5" />
                  </span>
                </div>
              </form>
            )}
          </motion.section>

          {/* ── Right: info card ── */}
          <motion.aside
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.12 }}
            className="relative"
          >
            {/* floating Send icon circle */}
            <div className="absolute -top-16 right-3 hidden h-28 w-28 items-center justify-center rounded-full bg-teal-600 text-white lg:flex">
              <div className="grid h-20 w-20 place-items-center rounded-full bg-white text-teal-600">
                <Send className="h-7 w-7" />
              </div>
            </div>

            <div className="rounded-2xl bg-gradient-to-br from-teal-600 via-teal-700 to-teal-900 p-9 shadow-[0_32px_80px_rgba(13,148,136,0.18)]">
              <div className="space-y-10">
                <section>
                  <div className="mb-4 flex items-center gap-3 text-white">
                    <MapPin className="h-5 w-5 flex-shrink-0" />
                    <h2 className="text-xl font-semibold tracking-[-0.03em]">Where we are</h2>
                  </div>
                  <p className="max-w-[280px] text-sm font-medium leading-6 text-white/75">
                    Remote-first team. We support businesses worldwide on WhatsApp, Instagram, Facebook, Telegram & TikTok.
                  </p>
                </section>

                <section>
                  <h2 className="mb-4 text-xl font-semibold tracking-[-0.03em] text-white">Email us</h2>
                  <a
                    href="mailto:hello@verzchat.com"
                    className="flex items-center gap-3 text-sm font-semibold text-white/80 transition hover:text-white"
                  >
                    <Mail className="h-4 w-4 flex-shrink-0 text-teal-200" />
                    hello@verzchat.com
                  </a>
                </section>

                <section>
                  <h2 className="mb-4 text-xl font-semibold tracking-[-0.03em] text-white">Response time</h2>
                  <p className="flex items-center gap-3 text-sm font-semibold text-white/80">
                    <Clock className="h-4 w-4 flex-shrink-0 text-teal-200" />
                    Within 24 hours on business days
                  </p>
                </section>

                <section>
                  <h2 className="mb-4 text-xl font-semibold tracking-[-0.03em] text-white">Stay connected</h2>
                  <div className="flex flex-wrap gap-3">
                    {socialLinks.map((social) => (
                      <a
                        key={social.name}
                        href={social.url}
                        aria-label={social.name}
                        target="_blank"
                        rel="noreferrer"
                        className="grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white transition hover:-translate-y-0.5 hover:bg-white hover:text-teal-700"
                      >
                        {social.icon}
                      </a>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          </motion.aside>
        </div>

        {/* Bottom CTA */}
        <div className="relative mx-auto w-[min(1160px,calc(100%-40px))] pb-16">
          <Link
            href="/book-demo"
            className="inline-flex items-center gap-2 text-sm font-bold text-gray-400 transition hover:text-teal-600"
          >
            Want a product walkthrough instead? Book a demo
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </main>
    </div>
  );
}
