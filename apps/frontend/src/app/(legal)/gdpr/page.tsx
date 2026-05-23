import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'GDPR — VerzChat',
  description: 'VerzChat GDPR compliance information for EU/EEA users.',
  alternates: { canonical: '/gdpr' },
};

export default function GdprPage() {
  return (
    <div className="max-w-3xl mx-auto px-5 sm:px-8 py-16">
      <div className="mb-10">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Last updated: 19 May 2026</p>
        <h1 className="text-4xl font-extrabold text-gray-900 mb-4">GDPR & Data Rights</h1>
        <p className="text-lg text-gray-500 leading-relaxed">
          If you or your customers are in the EU or UK, the GDPR applies. Here&apos;s exactly how we handle it.
        </p>
      </div>

      <div className="space-y-10">
        <Section title="Who is who">
          <p>When you use VerzChat to manage your customer conversations, you are the <strong>data controller</strong> for your customers&apos; personal data. You decide why and how it&apos;s processed.</p>
          <p>VerzChat acts as your <strong>data processor</strong>. We process your customers&apos; data only on your instructions (running the platform), not for our own purposes.</p>
          <p>For data about you as a VerzChat user (your account details, billing info), VerzChat is the data controller.</p>
        </Section>

        <Section title="Legal basis for processing">
          <p>We process your data on the basis of <strong>contract performance</strong>: you need us to process it to deliver the service you&apos;re paying for. For marketing emails (like product updates), we rely on <strong>legitimate interests</strong>, and you can opt out at any time.</p>
        </Section>

        <Section title="Your rights as a VerzChat user">
          <ul>
            <li><strong>Right to access:</strong> Ask us what data we hold and we&apos;ll send it within 30 days.</li>
            <li><strong>Right to rectification:</strong> Update your name, email, or business details in Settings at any time.</li>
            <li><strong>Right to erasure:</strong> Delete your account from Settings, or email us. We wipe everything within 90 days.</li>
            <li><strong>Right to portability:</strong> Export your contacts and conversations from the dashboard in CSV format.</li>
            <li><strong>Right to restrict processing:</strong> If you believe we&apos;re processing your data incorrectly, contact us and we&apos;ll pause processing while we investigate.</li>
            <li><strong>Right to object:</strong> You can object to processing based on legitimate interests. We&apos;ll stop unless we have compelling grounds.</li>
          </ul>
          <p>To exercise any of these rights, email <a href="mailto:notifications@verzchat.com" className="text-teal-700 underline">notifications@verzchat.com</a>. We&apos;ll respond within 30 days.</p>
        </Section>

        <Section title="Data transfers outside the EU">
          <p>VerzChat stores data on servers based in the EU. However, some subprocessors (Meta&apos;s WhatsApp API, DeepSeek for AI suggestions) operate internationally. Where data leaves the EU, we rely on standard contractual clauses (SCCs) or adequacy decisions.</p>
        </Section>

        <Section title="Subprocessors">
          <p>We use the following subprocessors to run the platform:</p>
          <ul>
            <li><strong>Meta Platforms</strong> — WhatsApp Business API delivery</li>
            <li><strong>DeepSeek</strong> — AI reply suggestions (only when Verz is enabled)</li>
            <li><strong>Stripe / Paystack / Flutterwave</strong> — Payment processing</li>
            <li><strong>Our cloud hosting provider</strong> — Server infrastructure</li>
          </ul>
          <p>We vet all subprocessors for GDPR compliance before using them. If you need a full DPA (Data Processing Agreement), email us and we&apos;ll send one.</p>
        </Section>

        <Section title="Data breach notification">
          <p>If there&apos;s a breach that affects your personal data, we&apos;ll notify you within 72 hours of becoming aware of it, as required by GDPR Article 33.</p>
        </Section>

        <Section title="Supervisory authority">
          <p>If you believe we&apos;ve mishandled your data and we haven&apos;t resolved it to your satisfaction, you have the right to lodge a complaint with your national data protection authority.</p>
        </Section>

        <Section title="Get in touch">
          <p>DPA requests, data subject requests, general GDPR questions: <a href="mailto:notifications@verzchat.com" className="text-teal-700 underline">notifications@verzchat.com</a>.</p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-bold text-gray-900 mb-4">{title}</h2>
      <div className="text-gray-600 leading-relaxed space-y-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2 [&_a]:text-teal-700 [&_a]:underline">
        {children}
      </div>
    </section>
  );
}
