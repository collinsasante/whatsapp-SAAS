import { Pricing2 } from '@/components/ui/pricing-cards';

const PLAN = {
  id: 'pro',
  name: 'VerzChat',
  description: 'Everything included. No per-message fees, no surprise charges.',
  monthlyPrice: '$25',
  yearlyPrice: '$20',
  features: [
    { text: 'Unlimited agents' },
    { text: 'Unlimited messages' },
    { text: 'Up to 3 WhatsApp channels' },
    { text: 'Shared team inbox' },
    { text: 'Broadcast campaigns' },
    { text: 'Chatbot automation (no-code)' },
    { text: 'AI reply suggestions' },
    { text: 'Analytics & CSAT' },
    { text: 'Contact management (20k+ contacts)' },
    { text: 'Priority support' },
  ],
  button: { text: 'Get Started', url: '/auth/register' },
};

export default function Pricing() {
  return (
    <section id="pricing" className="row_am_lg">
      <div className="container">
        <Pricing2
          heading="Simple, Honest Pricing"
          description="One plan. Everything included. No per-message fees, no surprise charges."
          plans={[PLAN]}
        />
        <p className="text-center mt-4" style={{ color: 'rgba(255,255,255,.4)', fontSize: 13 }}>
          Need a custom plan for a large team?{' '}
          <a href="mailto:support@verzchat.com" style={{ color: 'rgba(255,255,255,.65)', textDecoration: 'underline' }}>
            Talk to us
          </a>
        </p>
      </div>
    </section>
  );
}
