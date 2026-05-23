import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service — VerzChat',
  description: 'VerzChat terms of service — understand your rights and responsibilities when using our platform.',
  alternates: { canonical: '/terms' },
};

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-5 sm:px-8 py-16">
      <div className="mb-10">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Last updated: 19 May 2026</p>
        <h1 className="text-4xl font-extrabold text-gray-900 mb-4">Terms of Service</h1>
        <p className="text-lg text-gray-500 leading-relaxed">
          By using VerzChat, you agree to these terms. We&apos;ve written them to be readable, not to trap you. If something isn&apos;t clear, email us.
        </p>
      </div>

      <div className="space-y-10">
        <Section title="The basics">
          <p>VerzChat is a business messaging platform. You use it to manage customer conversations through WhatsApp, Instagram, Messenger, and Telegram. You need a business to sign up, and you&apos;re responsible for how your team uses the platform.</p>
          <p>By creating an account, you confirm that you&apos;re at least 18 years old and have the authority to agree to these terms on behalf of your business.</p>
        </Section>

        <Section title="What you can and can't do">
          <p>You can use VerzChat for any legitimate business communication: customer support, sales, marketing campaigns, chatbots, internal team workflows.</p>
          <p>You can&apos;t use it to send spam, run scams, harass people, or violate Meta&apos;s WhatsApp Business Platform policies (which you agree to separately when you connect a number). If we find out you&apos;re doing any of this, we&apos;ll suspend your account immediately.</p>
          <p>You also can&apos;t resell or white-label VerzChat without a written agreement from us.</p>
        </Section>

        <Section title="Billing">
          <p>The Pro plan is GH₵150/month (approx. $12 USD). Annual billing is GH₵1,500/year. Prices are in GHS for local payments (Paystack, Flutterwave) and USD for international (Stripe).</p>
          <p>Your subscription renews automatically at the start of each billing period. You can cancel anytime from your billing settings and you&apos;ll keep access until the end of the period you paid for. We don&apos;t offer refunds for partial months, but if something went wrong on our end we&apos;ll make it right.</p>
          <p>If a payment fails, we&apos;ll email you and give you 7 days to sort it out before suspending the account.</p>
        </Section>

        <Section title="Your data">
          <p>Your conversations, contacts, and workspace data belong to you. We don&apos;t claim any ownership over it. When you delete your account, we delete your data within 90 days. See our <a href="/privacy" className="text-teal-700 underline">Privacy Policy</a> for the full picture.</p>
        </Section>

        <Section title="Uptime and reliability">
          <p>We target 99.9% uptime and publish our status at <a href="/status" className="text-teal-700 underline">verzchat.com/status</a>. Planned maintenance gets announced at least 24 hours in advance. If we have unexpected downtime that affects your business, contact us and we&apos;ll work something out.</p>
        </Section>

        <Section title="Liability">
          <p>We work hard to keep VerzChat reliable, but we can&apos;t guarantee the platform will always be available or that messages will always be delivered on time. WhatsApp delivery ultimately depends on Meta&apos;s infrastructure, which is outside our control.</p>
          <p>To the extent permitted by law, our liability to you is capped at the amount you&apos;ve paid us in the last 3 months.</p>
        </Section>

        <Section title="Changes to these terms">
          <p>If we make significant changes, we&apos;ll email you at least 14 days before they take effect. Continuing to use VerzChat after that means you agree to the new terms. If you don&apos;t agree, you can cancel your account.</p>
        </Section>

        <Section title="Contact">
          <p>Questions, disputes, anything at all: <a href="mailto:notifications@verzchat.com" className="text-teal-700 underline">notifications@verzchat.com</a>. We&apos;re a real team and we respond.</p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-bold text-gray-900 mb-4">{title}</h2>
      <div className="text-gray-600 leading-relaxed space-y-3 [&_a]:text-teal-700 [&_a]:underline">
        {children}
      </div>
    </section>
  );
}
