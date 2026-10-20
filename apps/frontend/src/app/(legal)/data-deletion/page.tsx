import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Data Deletion — VerzChat',
  description: 'How to request deletion of your VerzChat account and data.',
  alternates: { canonical: '/data-deletion' },
};

export default function DataDeletionPage() {
  return (
    <div className="max-w-3xl mx-auto px-5 sm:px-8 py-16">
      <div className="mb-10">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Last updated: 12 October 2026</p>
        <h1 className="text-4xl font-extrabold text-gray-900 mb-4">Data Deletion</h1>
        <p className="text-lg text-gray-500 leading-relaxed">
          How to request that VerzChat delete your account and the data associated with it.
        </p>
      </div>

      <div className="space-y-10">
        <Section title="Delete your account yourself">
          <p>Go to <strong>Settings → Account</strong> inside VerzChat and choose <strong>Delete Account</strong>. This immediately deactivates your workspace and starts the deletion process described below. No one else can do this for you — it requires being signed in as the account owner.</p>
        </Section>

        <Section title="Request deletion by email">
          <p>If you can&apos;t sign in, or you connected VerzChat via Facebook/Instagram Login and want your data removed, email <a href="mailto:notifications@verzchat.com" className="text-teal-700 underline">notifications@verzchat.com</a> from the email address on your account and ask us to delete it. We&apos;ll confirm your identity and process the request.</p>
        </Section>

        <Section title="What gets deleted">
          <p>Your account, workspace settings, connected channels, contacts, conversations, campaigns, and any files you uploaded. We wipe everything within <strong>90 days</strong> of a confirmed deletion request.</p>
          <p>Data we&apos;re legally required to retain for a shorter defined period (e.g. billing records, for tax/accounting purposes) is kept only as long as the law requires, then deleted.</p>
        </Section>

        <Section title="Facebook/Instagram-connected data specifically">
          <p>If you connected a Facebook Page or Instagram account to VerzChat, deleting your VerzChat account also removes the Page/Instagram access tokens and any Messenger/Instagram conversation history we stored on your behalf. It does not delete anything on Facebook or Instagram itself — manage that directly in your Meta Accounts Center.</p>
        </Section>

        <Section title="Questions">
          <p>See our <a href="/privacy" className="text-teal-700 underline">Privacy Policy</a> for the full picture of what we collect and why, or our <a href="/gdpr" className="text-teal-700 underline">GDPR page</a> if you&apos;re in the EU/UK. For anything else, email <a href="mailto:notifications@verzchat.com" className="text-teal-700 underline">notifications@verzchat.com</a>.</p>
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
