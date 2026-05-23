import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'API Docs — VerzChat',
  description: 'VerzChat API documentation — webhooks, REST endpoints, and integration guides for developers.',
  alternates: { canonical: '/api-docs' },
};

function CodeBlock({ code, lang = 'bash' }: { code: string; lang?: string }) {
  return (
    <div className="relative bg-gray-900 rounded-xl overflow-hidden my-4">
      <div className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-800/60 border-b border-white/[0.06]">
        <div className="w-2 h-2 rounded-full bg-red-500/60" />
        <div className="w-2 h-2 rounded-full bg-yellow-500/60" />
        <div className="w-2 h-2 rounded-full bg-green-500/60" />
        <span className="text-[10px] text-gray-500 ml-2">{lang}</span>
      </div>
      <pre className="px-5 py-4 text-[13px] text-gray-300 overflow-x-auto leading-relaxed whitespace-pre-wrap">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function ApiDocsPage() {
  return (
    <div className="max-w-3xl mx-auto px-5 sm:px-8 py-16">
      <div className="mb-10">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">API v1</p>
        <h1 className="text-4xl font-extrabold text-gray-900 mb-4">API Docs</h1>
        <p className="text-lg text-gray-500 leading-relaxed">
          VerzChat exposes a webhook API so you can react to incoming messages, conversation events, and status changes in your own systems. Full REST API access is included in the Pro plan.
        </p>
      </div>

      <div className="space-y-12">
        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Authentication</h2>
          <p className="text-gray-600 mb-3">All API requests require an API key in the <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono">Authorization</code> header. Generate keys in Settings &rsaquo; API Keys.</p>
          <CodeBlock lang="http" code={`GET /api/conversations
Authorization: Bearer vz_live_your_api_key_here
Content-Type: application/json`} />
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Outbound webhooks</h2>
          <p className="text-gray-600 mb-3">Configure a URL in Settings &rsaquo; Webhooks and VerzChat will POST to it whenever something happens. Each event has a <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono">type</code> field and a <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono">data</code> object.</p>

          <h3 className="font-semibold text-gray-800 mt-6 mb-2">message.received</h3>
          <p className="text-sm text-gray-500 mb-2">Fires when a new inbound message arrives.</p>
          <CodeBlock lang="json" code={`{
  "type": "message.received",
  "timestamp": "2026-05-19T14:31:00Z",
  "data": {
    "id": "msg_abc123",
    "conversationId": "conv_xyz456",
    "contactPhone": "+233201234567",
    "contactName": "Sarah K.",
    "channel": "WHATSAPP",
    "content": "Hi, my order hasn't arrived yet.",
    "direction": "INBOUND"
  }
}`} />

          <h3 className="font-semibold text-gray-800 mt-6 mb-2">conversation.assigned</h3>
          <p className="text-sm text-gray-500 mb-2">Fires when a conversation is assigned to an agent.</p>
          <CodeBlock lang="json" code={`{
  "type": "conversation.assigned",
  "timestamp": "2026-05-19T14:32:00Z",
  "data": {
    "conversationId": "conv_xyz456",
    "agentId": "user_agent001",
    "agentName": "Alice"
  }
}`} />

          <h3 className="font-semibold text-gray-800 mt-6 mb-2">conversation.resolved</h3>
          <p className="text-sm text-gray-500 mb-2">Fires when a conversation is marked resolved.</p>
          <CodeBlock lang="json" code={`{
  "type": "conversation.resolved",
  "timestamp": "2026-05-19T15:00:00Z",
  "data": {
    "conversationId": "conv_xyz456",
    "resolvedBy": "user_agent001",
    "resolvedAt": "2026-05-19T15:00:00Z"
  }
}`} />
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Verifying webhook signatures</h2>
          <p className="text-gray-600 mb-3">Every webhook POST includes an <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono">X-VerzChat-Signature</code> header. Verify it with your webhook secret to make sure the request actually came from us.</p>
          <CodeBlock lang="typescript" code={`import crypto from 'crypto';

function verifyWebhook(secret: string, body: string, signature: string): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature)
  );
}`} />
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">REST endpoints</h2>
          <p className="text-gray-600 mb-4">Base URL: <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono">https://api.verzchat.com/v1</code></p>

          <div className="divide-y divide-gray-100 border border-gray-200 rounded-2xl overflow-hidden">
            {[
              { method: 'GET', path: '/conversations', desc: 'List conversations with filters (status, assignee, channel)' },
              { method: 'GET', path: '/conversations/:id', desc: 'Get a single conversation with messages' },
              { method: 'POST', path: '/messages', desc: 'Send a message to a contact' },
              { method: 'GET', path: '/contacts', desc: 'List all contacts, searchable' },
              { method: 'POST', path: '/contacts', desc: 'Create or update a contact' },
              { method: 'GET', path: '/agents', desc: 'List all agents in your workspace' },
            ].map((ep) => (
              <div key={ep.path} className="flex items-start gap-4 px-5 py-3.5">
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded flex-shrink-0 mt-0.5 ${
                  ep.method === 'GET' ? 'bg-blue-100 text-blue-700' : 'bg-teal-100 text-teal-700'
                }`}>{ep.method}</span>
                <div>
                  <code className="text-sm font-mono text-gray-800">{ep.path}</code>
                  <p className="text-xs text-gray-500 mt-0.5">{ep.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Rate limits</h2>
          <p className="text-gray-600">API requests are limited to 100 per minute per workspace. Webhook deliveries are attempted 3 times with exponential backoff if your endpoint returns an error.</p>
        </section>

        <div className="p-5 bg-gray-50 border border-gray-200 rounded-2xl">
          <p className="text-sm text-gray-600">
            Need something specific? Building an integration? Email us at{' '}
            <a href="mailto:notifications@verzchat.com" className="text-teal-700 underline">notifications@verzchat.com</a> and we can usually help quickly.
          </p>
        </div>
      </div>
    </div>
  );
}
