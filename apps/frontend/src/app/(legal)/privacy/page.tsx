import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — VerzChat',
};

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-5 sm:px-8 py-16">
      <div className="mb-10">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Last updated: 19 May 2026</p>
        <h1 className="text-4xl font-extrabold text-gray-900 mb-4">Privacy Policy</h1>
        <p className="text-lg text-gray-500 leading-relaxed">
          Short version: we collect what we need to run the platform, we don&apos;t sell it, and you can ask us to delete everything at any time. Here&apos;s the full version.
        </p>
      </div>

      <div className="prose prose-gray max-w-none space-y-10">
        <Section title="What we collect and why">
          <p>When you sign up, we collect your name, email address, and business name. That&apos;s how we create your workspace and send you receipts.</p>
          <p>As you use the platform, we store the WhatsApp conversations your team handles. Those messages arrive through Meta&apos;s servers first, then land in VerzChat so your agents can work on them together. We also store the contact details of the customers you message, and usage data like which features you&apos;re using and when.</p>
          <p>We never see your payment card details. Payments go through Paystack, Flutterwave, or Stripe directly, and those providers handle the sensitive stuff.</p>
        </Section>

        <Section title="The AI part (Verz)">
          <p>When you turn on Verz, the AI assistant, messages from your conversations are sent to DeepSeek&apos;s API to generate reply suggestions. DeepSeek does not use your data to train their models, and we only send the minimum context needed for each suggestion. You can turn Verz off at any time from your AI settings.</p>
        </Section>

        <Section title="What we don't do">
          <ul>
            <li>We don&apos;t sell your data. Not to advertisers, not to data brokers, not to anyone.</li>
            <li>We don&apos;t use your customers&apos; contact information for anything outside of what you asked us to do.</li>
            <li>We don&apos;t share your data with third parties except the services that make the platform run: Meta (for WhatsApp), our cloud hosting provider, and payment processors.</li>
          </ul>
        </Section>

        <Section title="How long we keep your data">
          <p>While your account is active: as long as you need it. After you delete your account, we keep your data for 90 days in case you change your mind. After that it&apos;s gone from all our systems, including backups.</p>
        </Section>

        <Section title="Your rights">
          <ul>
            <li><strong>Access:</strong> email us at notifications@verzchat.com and we&apos;ll send you everything we have.</li>
            <li><strong>Delete:</strong> go to Settings &rsaquo; Account &rsaquo; Delete account, or email us and we&apos;ll do it manually.</li>
            <li><strong>Export:</strong> your contacts and conversation history are exportable from the dashboard.</li>
            <li><strong>EU users:</strong> you have full GDPR rights. See our <a href="/gdpr" className="text-teal-700 underline">GDPR page</a> for details.</li>
          </ul>
        </Section>

        <Section title="Security">
          <p>Messages are encrypted in transit (TLS 1.3) and at rest (AES-256). We run daily encrypted backups and store them separately from live data. We keep access logs and review them for anomalies.</p>
          <p>If we ever have a breach that affects you, we&apos;ll tell you within 72 hours. That&apos;s not just policy, it&apos;s required by law in most places we operate.</p>
        </Section>

        <Section title="Cookies">
          <p>We use one session cookie to keep you logged in. We don&apos;t use tracking cookies, ad pixels, or third-party analytics on the platform. The marketing site uses minimal analytics to understand which pages people read, but nothing that identifies you individually.</p>
        </Section>

        <Section title="Questions">
          <p>If you have any questions about this policy or want to exercise your rights, email us at <a href="mailto:notifications@verzchat.com" className="text-teal-700 underline">notifications@verzchat.com</a>. We&apos;re a small team and we actually read these.</p>
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
