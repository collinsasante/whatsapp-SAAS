'use client';
import { useState } from 'react';
import Link from 'next/link';

const REGIONS = ['Ghana', 'Nigeria', 'Kenya', 'South Africa', 'International'];

const PLANS = {
  Ghana: [
    { name: 'Starter',   price: 'GHS 80',  sub: '/month',  popular: false, features: ['3 agents', '5,000 messages/mo', '1 WhatsApp channel', 'Shared team inbox', 'Basic chatbot', 'Standard support', false, false] },
    { name: 'Growth',    price: 'GHS 150', sub: '/month',  popular: true,  badge: 'Most Popular', features: ['10 agents', '25,000 messages/mo', '3 WhatsApp channels', 'Shared team inbox', 'Advanced chatbot + AI', 'Priority support', 'Broadcast campaigns', 'Analytics & CSAT'] },
    { name: 'Scale',     price: 'GHS 280', sub: '/month',  popular: false, features: ['Unlimited agents', 'Unlimited messages', 'Unlimited channels', 'Shared team inbox', 'Full AI + knowledge base', '24/7 dedicated support', 'Broadcast campaigns', 'Custom integrations & API'] },
  ],
  Nigeria: [
    { name: 'Starter',   price: '₦6,000',  sub: '/month', popular: false, features: ['3 agents', '5,000 messages/mo', '1 WhatsApp channel', 'Shared team inbox', 'Basic chatbot', 'Standard support', false, false] },
    { name: 'Growth',    price: '₦12,000', sub: '/month', popular: true,  badge: 'Most Popular', features: ['10 agents', '25,000 messages/mo', '3 WhatsApp channels', 'Shared team inbox', 'Advanced chatbot + AI', 'Priority support', 'Broadcast campaigns', 'Analytics & CSAT'] },
    { name: 'Scale',     price: '₦22,000', sub: '/month', popular: false, features: ['Unlimited agents', 'Unlimited messages', 'Unlimited channels', 'Shared team inbox', 'Full AI + knowledge base', '24/7 dedicated support', 'Broadcast campaigns', 'Custom integrations & API'] },
  ],
  Kenya: [
    { name: 'Starter',   price: 'KES 800',   sub: '/month', popular: false, features: ['3 agents', '5,000 messages/mo', '1 WhatsApp channel', 'Shared team inbox', 'Basic chatbot', 'Standard support', false, false] },
    { name: 'Growth',    price: 'KES 1,500', sub: '/month', popular: true,  badge: 'Most Popular', features: ['10 agents', '25,000 messages/mo', '3 WhatsApp channels', 'Shared team inbox', 'Advanced chatbot + AI', 'Priority support', 'Broadcast campaigns', 'Analytics & CSAT'] },
    { name: 'Scale',     price: 'KES 2,800', sub: '/month', popular: false, features: ['Unlimited agents', 'Unlimited messages', 'Unlimited channels', 'Shared team inbox', 'Full AI + knowledge base', '24/7 dedicated support', 'Broadcast campaigns', 'Custom integrations & API'] },
  ],
  'South Africa': [
    { name: 'Starter',   price: 'R 90',  sub: '/month', popular: false, features: ['3 agents', '5,000 messages/mo', '1 WhatsApp channel', 'Shared team inbox', 'Basic chatbot', 'Standard support', false, false] },
    { name: 'Growth',    price: 'R 180', sub: '/month', popular: true,  badge: 'Most Popular', features: ['10 agents', '25,000 messages/mo', '3 WhatsApp channels', 'Shared team inbox', 'Advanced chatbot + AI', 'Priority support', 'Broadcast campaigns', 'Analytics & CSAT'] },
    { name: 'Scale',     price: 'R 340', sub: '/month', popular: false, features: ['Unlimited agents', 'Unlimited messages', 'Unlimited channels', 'Shared team inbox', 'Full AI + knowledge base', '24/7 dedicated support', 'Broadcast campaigns', 'Custom integrations & API'] },
  ],
  International: [
    { name: 'Starter',   price: '$5',  sub: '/month', popular: false, features: ['3 agents', '5,000 messages/mo', '1 WhatsApp channel', 'Shared team inbox', 'Basic chatbot', 'Standard support', false, false] },
    { name: 'Growth',    price: '$10', sub: '/month', popular: true,  badge: 'Most Popular', features: ['10 agents', '25,000 messages/mo', '3 WhatsApp channels', 'Shared team inbox', 'Advanced chatbot + AI', 'Priority support', 'Broadcast campaigns', 'Analytics & CSAT'] },
    { name: 'Scale',     price: '$18', sub: '/month', popular: false, features: ['Unlimited agents', 'Unlimited messages', 'Unlimited channels', 'Shared team inbox', 'Full AI + knowledge base', '24/7 dedicated support', 'Broadcast campaigns', 'Custom integrations & API'] },
  ],
} as const;

export default function Pricing() {
  const [region, setRegion] = useState<keyof typeof PLANS>('Ghana');
  const plans = PLANS[region];

  return (
    <section id="pricing" className="row_am_lg">
      <div className="container">
        <div className="pricing_wrap">
          <div className="text-center sec_title" data-aos="fade-up">
            <span className="sec_badge">Pricing</span>
            <h2>Simple, Honest Pricing</h2>
            <p>No per-message fees. No surprise seat charges. Start free, upgrade when you&apos;re ready.</p>
          </div>

          <div data-aos="fade-up" data-aos-delay="100">
            <div className="region_tabs">
              {REGIONS.map((r) => (
                <button
                  key={r}
                  className={region === r ? 'active' : ''}
                  onClick={() => setRegion(r as keyof typeof PLANS)}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="row g-4" data-aos="fade-up" data-aos-delay="150">
            {plans.map((plan) => (
              <div key={plan.name} className="col-md-4">
                <div className={`price_card${plan.popular ? ' popular' : ''}`}>
                  {'badge' in plan && plan.badge && <span className="pop_badge">{plan.badge}</span>}
                  <p className="plan_lbl">{plan.name}</p>
                  <div className="price_val">{plan.price}</div>
                  <p className="price_sub">{plan.sub} · 7-day free trial</p>
                  <hr />
                  <ul className="pf_list">
                    {(plan.features as unknown as (string | boolean)[]).map((f, i) =>
                      f !== false ? (
                        <li key={i}><span className="ck">✓</span>{f as string}</li>
                      ) : (
                        <li key={i} style={{ opacity: .4 }}><span className="xk">✕</span>—</li>
                      )
                    )}
                  </ul>
                  <Link href="/auth/register" className={plan.popular ? 'btn_dark' : 'btn_green'} style={{ width: '100%', textAlign: 'center', display: 'block', fontSize: 14, padding: '11px 20px' }}>
                    Start free trial
                  </Link>
                </div>
              </div>
            ))}
          </div>

          <p className="text-center mt-4" style={{ color: 'rgba(255,255,255,.4)', fontSize: 13 }}>
            Need a custom plan for a large team?{' '}
            <a href="mailto:support@verzchat.com" style={{ color: 'rgba(255,255,255,.65)', textDecoration: 'underline' }}>
              Talk to us →
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
