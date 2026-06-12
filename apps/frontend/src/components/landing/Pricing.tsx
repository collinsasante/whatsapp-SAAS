'use client';
import Link from 'next/link';

const FREE_FEATURES = [
  '1 WhatsApp channel',
  'Unlimited contacts',
  'Unlimited messages/month',
  '1 agent',
];

const STARTER_FEATURES = [
  '1 WhatsApp channel',
  'Unlimited contacts',
  'Unlimited messages/month',
  '2 agents',
  '3 templates',
  '3 automations',
];

const PRO_FEATURES = [
  '20 agents',
  '20,000 contacts',
  'Unlimited messages',
  '5 WhatsApp channels',
  'Chatbot automation',
  'AI reply suggestions',
  'Analytics & CSAT',
  'Priority support',
  '7-day free trial',
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
            {/* Free plan */}
            <div className="col-md-4 col-lg-3">
              <div className="price_card" style={{ textAlign: 'center' }}>
                <p className="plan_lbl">Free</p>
                <div className="price_val">₵0</div>
                <p className="price_sub">Forever free · No card needed</p>
                <hr />
                <ul className="pf_list" style={{ textAlign: 'left' }}>
                  {FREE_FEATURES.map((f) => (
                    <li key={f}><span className="ck">✓</span>{f}</li>
                  ))}
                </ul>
                <Link href="/auth/register" className="btn_dark" style={{ width: '100%', textAlign: 'center', display: 'block', fontSize: 13, padding: '10px 16px', marginTop: 4 }}>
                  Get Started Free
                </Link>
              </div>
            </div>

            {/* Starter plan */}
            <div className="col-md-4 col-lg-3">
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
                <Link href="/auth/register" className="btn_dark" style={{ width: '100%', textAlign: 'center', display: 'block', fontSize: 13, padding: '10px 16px', marginTop: 4 }}>
                  Get Started
                </Link>
              </div>
            </div>

            {/* Pro plan */}
            <div className="col-md-4 col-lg-3">
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
                <Link href="/auth/register" className="btn_dark" style={{ width: '100%', textAlign: 'center', display: 'block', fontSize: 13, padding: '10px 16px', marginTop: 4 }}>
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
