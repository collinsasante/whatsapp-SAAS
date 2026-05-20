'use client';
import { useState } from 'react';
import Link from 'next/link';

const STEPS = [
  { n: '01', title: 'Create your workspace', desc: 'Sign up in 60 seconds. No credit card required. Your workspace is ready instantly.' },
  { n: '02', title: 'Connect your WhatsApp number', desc: 'Link your existing WhatsApp Business number or get a new one. We handle the Meta API setup.' },
  { n: '03', title: 'Invite your team and go live', desc: 'Add agents, set roles, and start handling every customer message from one shared inbox.' },
];

const FAQS = [
  { q: 'How does the 7-day free trial work?', a: 'You get full access to all features for 7 days — no credit card required. At the end of the trial you choose a plan or your workspace pauses.' },
  { q: 'Can I use my existing WhatsApp Business number?', a: 'Yes. You can port your existing WhatsApp Business number to VerzChat. The process takes about 10 minutes and we guide you through it step by step.' },
  { q: 'Is there a per-message fee?', a: 'No. VerzChat charges a flat monthly fee — there are no per-message fees on your end. Standard WhatsApp conversation fees from Meta may apply depending on your usage.' },
  { q: 'How many team members can I add?', a: 'The Starter plan supports up to 3 agents. Growth supports 10. Scale is unlimited. You can upgrade at any time from your billing settings.' },
  { q: 'Can I upgrade or downgrade at any time?', a: 'Yes — plan changes take effect immediately. If you upgrade mid-cycle you only pay the prorated difference.' },
  { q: 'Do you support multiple WhatsApp channels?', a: 'Yes. Growth supports 3 channels and Scale is unlimited. Each channel is a separate WhatsApp Business number connected to the same inbox.' },
  { q: 'Is my customer data secure?', a: 'All data is encrypted at rest and in transit. We are fully compliant with GDPR and NDPR. Your data is never sold or shared with third parties.' },
  { q: 'What happens if I cancel?', a: 'You can cancel anytime with no penalties. Your workspace stays active until the end of the billing period, after which your data is retained for 30 days before deletion.' },
  { q: 'Do you offer customer support?', a: 'Yes — all plans include email and live chat support. Scale plan customers get a dedicated account manager and 24/7 priority support.' },
];

export default function BottomCTA() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <>
      {/* How it works */}
      <section className="row_am_lg">
        <div className="container">
          <div className="how_wrap">
            <div className="text-center sec_title" data-aos="fade-up">
              <span className="sec_badge">Getting Started</span>
              <h2>Live in Under 20 Minutes</h2>
              <p>No complex setup. No developer needed. Three steps and your entire team is managing WhatsApp from one inbox.</p>
            </div>

            <div className="row g-4 justify-content-center" data-aos="fade-up" data-aos-delay="100">
              {STEPS.map((step, i) => (
                <div key={step.n} className="col-md-4">
                  <div className="step_card">
                    <div className="step_num">{step.n}</div>
                    <h4>{step.title}</h4>
                    <p>{step.desc}</p>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className="step_divider d-none d-md-flex" style={{ position: 'absolute', top: '30px', right: '-20px' }}>→</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="faq_sec">
        <div className="container">
          <div className="row g-5 align-items-start">
            <div className="col-lg-4" data-aos="fade-right">
              <span className="sec_badge">FAQ</span>
              <h2 style={{ fontSize: 32, fontWeight: 800, marginTop: 10, marginBottom: 14 }}>Frequently Asked Questions</h2>
              <p style={{ fontSize: 14, color: 'var(--kp-muted)', lineHeight: 1.75 }}>
                Can&apos;t find what you&apos;re looking for? Reach us at{' '}
                <a href="mailto:support@verzchat.com" style={{ color: 'var(--kp)', textDecoration: 'underline' }}>support@verzchat.com</a>
              </p>
            </div>
            <div className="col-lg-8" data-aos="fade-left">
              <div className="accordion" id="faqAccordion">
                {FAQS.map((faq, i) => (
                  <div key={i} className="accordion-item">
                    <button
                      className={`accordion-button ${open === i ? '' : 'collapsed'}`}
                      onClick={() => setOpen(open === i ? null : i)}
                    >
                      {faq.q}
                    </button>
                    <div className={`accordion-collapse collapse ${open === i ? 'show' : ''}`}>
                      <div className="accordion-body">{faq.a}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section id="contact" className="cta_sec">
        <div className="container">
          <div data-aos="fade-up">
            <h2>Start Your Free Trial Today</h2>
            <p>Join hundreds of businesses using VerzChat to manage every customer conversation. 7 days free, no card required.</p>
            <div className="d-flex gap-3 justify-content-center flex-wrap">
              <Link href="/auth/register" className="btn_green">Get started free</Link>
              <Link href="/book-demo" className="btn_outline" style={{ borderColor: 'rgba(255,255,255,.3)', color: 'rgba(255,255,255,.8)' }}>Book a demo</Link>
            </div>
            <p className="mt-4" style={{ fontSize: 13, color: 'rgba(255,255,255,.35)' }}>No credit card · Cancel anytime · Live in 20 minutes</p>
          </div>
        </div>
      </section>
    </>
  );
}
