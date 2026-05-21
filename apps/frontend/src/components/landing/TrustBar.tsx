const ITEMS = [
  'Shared Team Inbox', 'Broadcast Campaigns', 'Chatbot Automation', 'Analytics & CSAT',
  'WhatsApp Business API', 'Multi-Agent Support', 'Message Templates', 'AI-Powered Replies',
  'Contact Management', 'Team Performance Tracking', 'Live Agent Handoff', 'Audit Logs',
  'Shared Team Inbox', 'Broadcast Campaigns', 'Chatbot Automation', 'Analytics & CSAT',
  'WhatsApp Business API', 'Multi-Agent Support', 'Message Templates', 'AI-Powered Replies',
  'Contact Management', 'Team Performance Tracking', 'Live Agent Handoff', 'Audit Logs',
];

export default function TrustBar() {
  return (
    <div className="ticker_wrap">
      <div className="ticker_inner">
        <div className="ticker_track">
          {ITEMS.map((item, i) => (
            <span key={i}>{item}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
