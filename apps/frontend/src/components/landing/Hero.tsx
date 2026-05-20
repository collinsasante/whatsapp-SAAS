'use client';
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import Typed from 'typed.js';

export default function Hero() {
  const typedEl = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!typedEl.current) return;
    const typed = new Typed(typedEl.current, {
      strings: ['WhatsApp Messages', 'Customer Conversations', 'Support Requests', 'Broadcast Campaigns'],
      typeSpeed: 55,
      backSpeed: 35,
      backDelay: 2200,
      loop: true,
    });
    return () => typed.destroy();
  }, []);

  return (
    <section className="hero_sec">
      <div className="container">
        <div className="row align-items-center g-5">
          {/* Left */}
          <div className="col-lg-6" data-aos="fade-right">
            <div className="hero_badge">
              <span className="dot" />
              Official Meta API Partner
            </div>
            <h1>
              Handle Every<br />
              <span className="typed-text">
                <span ref={typedEl} />
              </span>
              <br />from One Inbox.
            </h1>
            <p className="lead">
              VerzChat turns WhatsApp into a proper shared inbox. Every message, every customer, every agent
              in one place — with real-time delivery so nothing slips through.
            </p>
            <div className="d-flex align-items-center gap-3 flex-wrap">
              <Link href="/book-demo" className="btn_dark">Book a Demo</Link>
              <a href="#features" className="btn_outline">
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polygon points="5,3 19,12 5,21" fill="currentColor" /></svg>
                Watch Demo Video
              </a>
            </div>
            <div className="hero_meta">
              <span>7-day free trial</span>
              <span>·</span>
              <span>Live in under 20 minutes</span>
              <span>·</span>
              <span>Cancel anytime</span>
            </div>
          </div>

          {/* Right — inline inbox mockup */}
          <div className="col-lg-6" data-aos="fade-left" data-aos-delay="150">
            <div className="hero_img_wrap">
              <div className="hero_star_tl">✦</div>
              <div className="hero_star_br">✦</div>
              <div className="hero_mockup">
                {/* Mac-style title bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', background: '#161b22', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(255,77,77,.7)', display: 'inline-block' }} />
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(255,189,68,.7)', display: 'inline-block' }} />
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#25D366', display: 'inline-block', opacity: .8 }} />
                  <span style={{ marginLeft: 8, fontSize: 10, color: 'rgba(255,255,255,.35)', fontWeight: 600 }}>VerzChat Inbox</span>
                  <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#25D366', display: 'inline-block' }} />
                    <span style={{ fontSize: 9, color: '#25D366', fontWeight: 700 }}>3 agents online</span>
                  </span>
                </div>

                <div style={{ display: 'flex', height: 340 }}>
                  {/* Sidebar */}
                  <div style={{ width: '42%', borderRight: '1px solid rgba(255,255,255,.06)', background: '#0d1117' }}>
                    <div style={{ padding: '10px 10px 6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.05)', borderRadius: 8, padding: '6px 10px' }}>
                        <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="rgba(255,255,255,.3)" strokeWidth="2"><circle cx="6" cy="6" r="4" /><line x1="10" y1="10" x2="14" y2="14" /></svg>
                        <span style={{ fontSize: 9, color: 'rgba(255,255,255,.25)' }}>Search…</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, padding: '0 10px 8px' }}>
                      {['All', 'Open', 'Done'].map((t, i) => (
                        <span key={t} style={{ fontSize: 8, padding: '2px 8px', borderRadius: '50px', fontWeight: 700, background: i === 0 ? 'rgba(37,211,102,.15)' : 'transparent', color: i === 0 ? '#25D366' : 'rgba(255,255,255,.3)', border: `1px solid ${i === 0 ? 'rgba(37,211,102,.3)' : 'rgba(255,255,255,.08)'}` }}>{t}</span>
                      ))}
                    </div>
                    {[
                      { name: 'Sarah K.', preview: "Order hasn't arrived…", time: '2m', unread: 2, c: '#8b5cf6', active: true },
                      { name: 'Gulf Trading', preview: 'Can we schedule a call?', time: '14m', unread: 1, c: '#3b82f6', active: false },
                      { name: 'Ahmed H.', preview: 'Thanks, sorted! 👍', time: '1h', unread: 0, c: '#10b981', active: false },
                      { name: 'Maria R.', preview: 'Price for bulk order?', time: '2h', unread: 0, c: '#f97316', active: false },
                    ].map((conv) => (
                      <div key={conv.name} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 12px', borderBottom: '1px solid rgba(255,255,255,.04)', cursor: 'pointer', background: conv.active ? 'rgba(37,211,102,.07)' : 'transparent', borderLeft: conv.active ? '2px solid #25D366' : '2px solid transparent' }}>
                        <div style={{ width: 26, height: 26, borderRadius: '50%', background: conv.c, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, color: '#fff', flexShrink: 0 }}>{conv.name[0]}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: conv.active ? '#fff' : 'rgba(255,255,255,.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 70 }}>{conv.name}</span>
                            <span style={{ fontSize: 8, color: 'rgba(255,255,255,.3)', flexShrink: 0 }}>{conv.time}</span>
                          </div>
                          <p style={{ fontSize: 9, color: 'rgba(255,255,255,.35)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conv.preview}</p>
                        </div>
                        {conv.unread > 0 && <span style={{ width: 15, height: 15, borderRadius: '50%', background: '#25D366', color: '#fff', fontSize: 8, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{conv.unread}</span>}
                      </div>
                    ))}
                  </div>

                  {/* Chat area */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0a0f1a' }}>
                    <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,.06)', background: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#8b5cf6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, color: '#fff' }}>S</div>
                        <div>
                          <p style={{ margin: 0, fontSize: 10, fontWeight: 800, color: '#fff' }}>Sarah K.</p>
                          <p style={{ margin: 0, fontSize: 8, color: '#25D366' }}>online now</p>
                        </div>
                      </div>
                      <span style={{ fontSize: 7, fontWeight: 800, background: 'rgba(37,211,102,.15)', color: '#25D366', border: '1px solid rgba(37,211,102,.3)', padding: '2px 8px', borderRadius: 4 }}>OPEN</span>
                    </div>
                    <div style={{ flex: 1, padding: '12px', display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' }}>
                      {[
                        { text: "Order #4821 hasn't arrived. It's been 5 days!", from: 'them' },
                        { text: "Hi Sarah! Let me check that for you right now.", from: 'me' },
                        { text: "It's been at your local post office since yesterday. Want me to rebook delivery?", from: 'me' },
                        { text: 'Yes please — afternoon works better.', from: 'them' },
                      ].map((msg, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: msg.from === 'me' ? 'flex-end' : 'flex-start' }}>
                          <div style={{ maxWidth: '80%', padding: '7px 11px', borderRadius: msg.from === 'me' ? '12px 12px 3px 12px' : '12px 12px 12px 3px', fontSize: 9, lineHeight: 1.5, background: msg.from === 'me' ? '#25D366' : 'rgba(255,255,255,.08)', color: msg.from === 'me' ? '#fff' : 'rgba(255,255,255,.75)', border: msg.from === 'them' ? '1px solid rgba(255,255,255,.08)' : 'none' }}>
                            {msg.text}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,.06)' }}>
                      <div style={{ background: 'rgba(37,211,102,.08)', border: '1px solid rgba(37,211,102,.2)', borderRadius: 10, padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 8, fontWeight: 800, background: 'rgba(37,211,102,.2)', color: '#25D366', padding: '2px 6px', borderRadius: 4 }}>AI</span>
                        <span style={{ fontSize: 9, color: 'rgba(37,211,102,.8)', flex: 1 }}>Rebooked for 1–5pm today. Confirmation SMS sent ✓</span>
                        <span style={{ fontSize: 8, color: '#25D366', fontWeight: 700, cursor: 'pointer' }}>Use ↵</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
