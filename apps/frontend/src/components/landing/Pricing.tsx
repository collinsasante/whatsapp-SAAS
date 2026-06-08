'use client';
import Link from 'next/link';

const STARTER_FEATURES = [
  'Up to 3 agents',
  'Unlimited messages',
  '1 WhatsApp channel',
  'Shared team inbox',
  'Broadcast campaigns',
  'Contact management',
  'Basic analytics',
  'Email support',
];

const PRO_FEATURES = [
  'Unlimited agents',
  'Unlimited messages',
  'Up to 3 WhatsApp channels',
  'Shared team inbox',
  'Broadcast campaigns',
  'Chatbot automation (no-code)',
  'AI reply suggestions',
  'Analytics & CSAT',
  'Contact management (20k+ contacts)',
  'Priority support',
];

const GHS_RATE = 12.5;

function getIsGhana(): boolean {
  if (typeof window === 'undefined') return false;
  return Intl.DateTimeFormat().resolvedOptions().timeZone === 'Africa/Accra';
}

export default function Pricing() {
  const isGhana = getIsGhana();

  const starterUsd = 16;
  const proUsd = 25;
  const starterPrice = isGhana ? `₵${Math.round(starterUsd * GHS_RATE)}` : `$${starterUsd}`;
  const proPrice = isGhana ? `₵${Math.round(proUsd * GHS_RATE)}` : `$${proUsd}`;

  return (
    <section id="pricing" className="row_am_lg">
      <div className="container">
        <div className="pricing_wrap">
          <div className="text-center sec_title" data-aos="fade-up">
            <span className="sec_badge">Pricing</span>
            <h2>Simple, Honest Pricing</h2>
            <p>Pick a plan that fits your team. No per-message fees, no surprise charges.</p>
          </div>

          <div className="row justify-content-center" data-aos="fade-up" data-aos-delay="100">
            {/* Starter plan */}
            <div className="col-md-5 col-lg-4">
              <div className="price_card" style={{ textAlign: 'center' }}>
                <p className="plan_lbl">Starter</p>
                <div className="price_val">{starterPrice}</div>
                <p className="price_sub">/month · Cancel anytime</p>
                <hr />
                <ul className="pf_list" style={{ textAlign: 'left' }}>
                  {STARTER_FEATURES.map((f) => (
                    <li key={f}><span className="ck">✓</span>{f}</li>
                  ))}
                </ul>
                <Link href="/auth/register" className="btn_dark" style={{ width: '100%', textAlign: 'center', display: 'block', fontSize: 14, padding: '12px 20px', marginTop: 8 }}>
                  Get Started
                </Link>
              </div>
            </div>

            {/* Pro plan */}
            <div className="col-md-5 col-lg-4">
              <div className="price_card popular" style={{ textAlign: 'center' }}>
                <span className="pop_badge">Everything Included</span>
                <p className="plan_lbl">VerzChat Pro</p>
                <div className="price_val">{proPrice}</div>
                <p className="price_sub">/month · Cancel anytime</p>
                <hr />
                <ul className="pf_list" style={{ textAlign: 'left' }}>
                  {PRO_FEATURES.map((f) => (
                    <li key={f}><span className="ck">✓</span>{f}</li>
                  ))}
                </ul>
                <Link href="/auth/register" className="btn_dark" style={{ width: '100%', textAlign: 'center', display: 'block', fontSize: 14, padding: '12px 20px', marginTop: 8 }}>
                  Get Started
                </Link>
              </div>
            </div>
          </div>

          <p className="text-center mt-4" style={{ color: 'rgba(255,255,255,.4)', fontSize: 13 }}>
            Need a custom plan for a large team?{' '}
            <a href="mailto:support@verzchat.com" style={{ color: 'rgba(255,255,255,.65)', textDecoration: 'underline' }}>
              Talk to us
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
