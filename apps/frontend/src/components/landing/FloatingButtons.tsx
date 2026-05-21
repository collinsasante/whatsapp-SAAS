'use client';
import { useEffect, useState } from 'react';

export default function FloatingButtons() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div style={{
      position: 'fixed', bottom: 28, right: 24, zIndex: 999,
      display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center',
    }}>
      <a
        href="mailto:support@verzchat.com?subject=Feedback"
        title="Send feedback"
        style={{
          width: 44, height: 44, borderRadius: '50%',
          background: '#fff', border: '1px solid #e5e7eb',
          boxShadow: '0 4px 14px rgba(0,0,0,.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#374151', fontSize: 18, textDecoration: 'none',
          transition: 'transform .2s, box-shadow .2s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1.1)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
        </svg>
      </a>

      <button
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        title="Back to top"
        style={{
          width: 44, height: 44, borderRadius: '50%',
          background: '#25D366', border: 'none',
          boxShadow: '0 4px 14px rgba(37,211,102,.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 20, cursor: 'pointer',
          opacity: visible ? 1 : 0,
          pointerEvents: visible ? 'auto' : 'none',
          transform: visible ? 'translateY(0)' : 'translateY(12px)',
          transition: 'opacity .25s, transform .25s',
        }}
      >
        ↑
      </button>
    </div>
  );
}
