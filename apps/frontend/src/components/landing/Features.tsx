import Link from 'next/link';

const SECTIONS = [
  {
    badge: 'Shared Inbox',
    h3: 'Respond to customers 3× faster than before.',
    lead: 'When a message arrives, your entire team sees it instantly. One agent claims it, adds context, and resolves it — no duplicated replies, no Slack threads to track who\'s handling what.',
    bullets: [
      'Real-time agent assignment & routing',
      'Private notes only your team can see',
      'Conversation labels and custom tags',
      'Full message history with every contact',
    ],
    href: '/book-demo',
    cta: 'See the inbox',
    mockup: (
      <div style={{ background: '#0d1117', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ background: '#161b22', borderBottom: '1px solid rgba(255,255,255,.07)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,77,77,.7)' }} />
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,189,68,.7)' }} />
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#25D366', opacity: .8 }} />
          <span style={{ marginLeft: 6, fontSize: 9, color: 'rgba(255,255,255,.3)', fontWeight: 600 }}>Active Conversations · 24 open</span>
        </div>
        {[
          { name: 'Sarah K.', agent: 'Alice', status: 'Replied', c: '#8b5cf6', dot: '#25D366' },
          { name: 'Tech Corp', agent: 'Unassigned', status: 'Waiting', c: '#3b82f6', dot: '#f97316' },
          { name: 'Ahmed H.', agent: 'Bob', status: 'Resolved', c: '#10b981', dot: '#9ca3af' },
          { name: 'Kofi A.', agent: 'Alice', status: 'Replied', c: '#ec4899', dot: '#25D366' },
        ].map((r) => (
          <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: r.c, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: '#fff', flexShrink: 0 }}>{r.name[0]}</div>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#fff' }}>{r.name}</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: r.dot }} />
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,.4)' }}>{r.agent}</span>
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: r.status === 'Replied' ? 'rgba(37,211,102,.1)' : r.status === 'Waiting' ? 'rgba(249,115,22,.1)' : 'rgba(156,163,175,.1)', color: r.status === 'Replied' ? '#25D366' : r.status === 'Waiting' ? '#f97316' : '#9ca3af' }}>{r.status}</span>
          </div>
        ))}
        <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,.04)' }}>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,.3)' }}>Avg. response time</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#25D366' }}>2m 47s</span>
        </div>
      </div>
    ),
  },
  {
    badge: 'Campaigns',
    h3: 'Reach 10,000 customers without typing each one.',
    lead: 'Build a WhatsApp broadcast campaign in minutes. Upload your contact list, pick an approved template, and fire. Track who got it, who read it, and who clicked — all in real time.',
    bullets: [
      'One-click broadcasts to any contact segment',
      'Real-time delivery & read receipts',
      'Click-through tracking per campaign',
      'Schedule sends for optimal open times',
    ],
    href: '/book-demo',
    cta: 'See campaigns',
    mockup: (
      <div style={{ background: '#0d1117', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ background: '#161b22', borderBottom: '1px solid rgba(255,255,255,.07)', padding: '10px 16px' }}>
          <p style={{ margin: '0 0 2px', fontSize: 11, fontWeight: 800, color: '#fff' }}>Summer Sale Campaign</p>
          <p style={{ margin: 0, fontSize: 9, color: 'rgba(255,255,255,.35)' }}>12,450 recipients · WhatsApp · Sent</p>
        </div>
        <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          {[{ l: 'Delivered', v: '98.2%', bg: 'rgba(37,211,102,.1)', c: '#25D366' }, { l: 'Read', v: '67.4%', bg: 'rgba(59,130,246,.1)', c: '#3b82f6' }, { l: 'Clicked', v: '12.1%', bg: 'rgba(249,115,22,.1)', c: '#f97316' }].map((s) => (
            <div key={s.l} style={{ background: s.bg, borderRadius: 10, padding: '12px 8px', textAlign: 'center' }}>
              <p style={{ margin: '0 0 3px', fontSize: 18, fontWeight: 800, color: s.c }}>{s.v}</p>
              <p style={{ margin: 0, fontSize: 10, color: 'rgba(255,255,255,.5)' }}>{s.l}</p>
            </div>
          ))}
        </div>
        <div style={{ padding: '0 16px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 50 }}>
            {[55, 70, 65, 82, 78, 91, 88, 98].map((h, i) => (
              <div key={i} style={{ flex: 1, background: i === 7 ? '#25D366' : 'rgba(37,211,102,.2)', borderRadius: 4, height: `${h}%` }} />
            ))}
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 9, color: 'rgba(255,255,255,.3)', textAlign: 'right' }}>Hourly delivery rate</p>
        </div>
      </div>
    ),
  },
  {
    badge: 'Automation',
    h3: 'Let the bot handle FAQs. You handle the rest.',
    lead: 'Set up keyword-triggered chatbot flows in minutes — no code, no developer. The bot handles routine questions 24/7. When it\'s stuck, it hands off to a live agent instantly with full context.',
    bullets: [
      'No-code drag-and-drop flow builder',
      'AI-powered reply suggestions',
      'Instant live agent handoff with context',
      'Works 24/7 even when your team is offline',
    ],
    href: '/book-demo',
    cta: 'See automation',
    mockup: (
      <div style={{ background: '#0d1117', borderRadius: 14, overflow: 'hidden', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.5)' }}>Chatbot · Order Support</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: '#25D366', background: 'rgba(37,211,102,.1)', padding: '3px 10px', borderRadius: 20 }}>82% auto-handled</span>
        </div>
        {[
          { lbl: 'Trigger', txt: 'New message received', c: 'rgba(37,211,102,.1)', tc: '#25D366' },
          { lbl: 'Check', txt: 'Contains "order" or "track"', c: 'rgba(139,92,246,.1)', tc: '#8b5cf6' },
          { lbl: 'Reply', txt: 'Send order status template', c: 'rgba(59,130,246,.1)', tc: '#3b82f6' },
          { lbl: 'Wait', txt: '2 min · no response?', c: 'rgba(249,115,22,.1)', tc: '#f97316' },
          { lbl: 'Assign', txt: 'Route to Support team', c: 'rgba(156,163,175,.1)', tc: '#9ca3af' },
        ].map((n, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: n.c, borderRadius: 8, padding: '8px 12px', marginBottom: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', color: n.tc, width: 42, flexShrink: 0 }}>{n.lbl}</span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,.7)', fontWeight: 500 }}>{n.txt}</span>
          </div>
        ))}
        <div style={{ marginTop: 14, padding: '10px 12px', background: 'rgba(37,211,102,.06)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,.4)' }}>Conversations handled today</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: '#25D366' }}>1,247</span>
        </div>
      </div>
    ),
  },
];

export default function Features() {
  return (
    <section id="features" className="features_showcase">
      <div className="text-center sec_title" data-aos="fade-up">
        <span className="sec_badge">Platform</span>
        <h2>Everything in One Inbox</h2>
        <p>Three powerful tools, one platform. Handle every customer conversation without switching tabs or losing context.</p>
      </div>

      {SECTIONS.map((sec, idx) => (
        <div
          key={sec.badge}
          className={`fs_row${idx % 2 === 1 ? ' fs_row_flip' : ''}`}
          data-aos="fade-up"
          data-aos-delay="80"
        >
          <div className="fs_content">
            <div className="fs_num">0{idx + 1}</div>
            <span className="sec_badge">{sec.badge}</span>
            <h3 className="fs_h3">{sec.h3}</h3>
            <p className="fs_lead">{sec.lead}</p>
            <ul className="fs_bullets">
              {sec.bullets.map((b) => (
                <li key={b}>
                  <span className="fs_check">✓</span>
                  {b}
                </li>
              ))}
            </ul>
            <Link href={sec.href} className="btn_green" style={{ fontSize: 14, padding: '10px 28px' }}>
              {sec.cta} →
            </Link>
          </div>
          <div className="fs_visual">{sec.mockup}</div>
        </div>
      ))}
    </section>
  );
}
