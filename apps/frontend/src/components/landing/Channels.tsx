'use client';
import { useRef } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Autoplay } from 'swiper/modules';
import type { Swiper as SwiperType } from 'swiper';
import 'swiper/css';

const SLIDES = [
  {
    title: 'Shared Team Inbox',
    desc: 'Every WhatsApp message lands in one shared inbox. Assign to agents, add private notes, and resolve — no "who\'s handling this?"',
    mockup: (
      <div style={{ background: '#f8fafc', borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
        <div style={{ background: '#0d1117', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'rgba(255,77,77,.7)' }} />
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'rgba(255,189,68,.7)' }} />
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#25D366', opacity: .8 }} />
          <span style={{ marginLeft: 6, fontSize: 9, color: 'rgba(255,255,255,.4)', fontWeight: 600 }}>VerzChat · 12 open</span>
        </div>
        {[
          { name: 'Sarah K.', msg: "Order hasn't arrived…", status: 'Waiting', dot: '#f97316', c: '#8b5cf6' },
          { name: 'Tech Corp', msg: 'Can we schedule a call?', status: 'Replied', dot: '#25D366', c: '#3b82f6' },
          { name: 'Ahmed H.', msg: 'Thanks, sorted! 👍', status: 'Resolved', dot: '#9ca3af', c: '#10b981' },
          { name: 'Kofi A.', msg: 'Price for bulk order?', status: 'Waiting', dot: '#f97316', c: '#ec4899' },
        ].map((r) => (
          <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', borderBottom: '1px solid #f1f5f9', background: '#fff' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: r.c, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: '#fff', flexShrink: 0 }}>{r.name[0]}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: '0 0 2px', fontSize: 11, fontWeight: 700, color: '#111' }}>{r.name}</p>
              <p style={{ margin: 0, fontSize: 10, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.msg}</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: r.dot }} />
              <span style={{ fontSize: 9, color: '#64748b', fontWeight: 600 }}>{r.status}</span>
            </div>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: 'Broadcast Campaigns',
    desc: 'Send to thousands at once. Upload your contact list, pick an approved template, and track delivery, reads, and clicks in real time.',
    mockup: (
      <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
        <div style={{ background: '#0d1117', padding: '8px 14px' }}>
          <p style={{ margin: '0 0 1px', fontSize: 11, fontWeight: 800, color: '#fff' }}>Summer Sale Campaign</p>
          <p style={{ margin: 0, fontSize: 9, color: 'rgba(255,255,255,.4)' }}>12,450 recipients · Sent</p>
        </div>
        <div style={{ padding: '14px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {[{ l: 'Delivered', v: '98.2%', bg: '#f0fdf4', c: '#16a34a' }, { l: 'Read', v: '67.4%', bg: '#eff6ff', c: '#2563eb' }, { l: 'Clicked', v: '12.1%', bg: '#fff7ed', c: '#ea580c' }].map((s) => (
            <div key={s.l} style={{ background: s.bg, borderRadius: 8, padding: '10px 6px', textAlign: 'center' }}>
              <p style={{ margin: '0 0 2px', fontSize: 16, fontWeight: 800, color: s.c }}>{s.v}</p>
              <p style={{ margin: 0, fontSize: 9, color: '#64748b' }}>{s.l}</p>
            </div>
          ))}
        </div>
        <div style={{ padding: '0 14px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 48 }}>
            {[55, 70, 65, 82, 78, 91, 88, 98].map((h, i) => (
              <div key={i} style={{ flex: 1, background: i === 7 ? '#25D366' : '#bbf7d0', borderRadius: 3, height: `${h}%` }} />
            ))}
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 9, color: '#94a3b8' }}>Message opens over time</p>
        </div>
      </div>
    ),
  },
  {
    title: 'Chatbot Automation',
    desc: 'Build no-code flows in minutes. The bot handles routine questions 24/7 and hands off to a live agent the moment it gets stuck.',
    mockup: (
      <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0', padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#374151' }}>Order Support Bot</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', background: '#f0fdf4', padding: '2px 8px', borderRadius: 20 }}>82% handled</span>
        </div>
        {[
          { lbl: 'Trigger', txt: 'New message received', bg: '#f0fdf4', tc: '#16a34a' },
          { lbl: 'Check', txt: 'Contains "order" or "track"', bg: '#f5f3ff', tc: '#7c3aed' },
          { lbl: 'Reply', txt: 'Send order status template', bg: '#eff6ff', tc: '#2563eb' },
          { lbl: 'Wait', txt: '2 min · no response?', bg: '#fff7ed', tc: '#ea580c' },
          { lbl: 'Assign', txt: 'Route to Support team', bg: '#f8fafc', tc: '#64748b' },
        ].map((n) => (
          <div key={n.lbl} style={{ display: 'flex', alignItems: 'center', gap: 8, background: n.bg, borderRadius: 7, padding: '7px 10px', marginBottom: 5 }}>
            <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', color: n.tc, width: 40, flexShrink: 0 }}>{n.lbl}</span>
            <span style={{ fontSize: 10, color: '#374151', fontWeight: 500 }}>{n.txt}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: 'Analytics & CSAT',
    desc: 'Track response times, resolution rates, and customer satisfaction scores — updated live so you always know where your team stands.',
    mockup: (
      <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0', padding: 14 }}>
        <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 700, color: '#374151' }}>Team Performance — May 2026</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          {[{ l: 'Avg Response', v: '4m 12s', c: '#2563eb', bg: '#eff6ff' }, { l: 'Resolved Today', v: '142', c: '#16a34a', bg: '#f0fdf4' }, { l: 'CSAT Score', v: '96%', c: '#7c3aed', bg: '#f5f3ff' }, { l: 'Open Now', v: '23', c: '#ea580c', bg: '#fff7ed' }].map((s) => (
            <div key={s.l} style={{ background: s.bg, borderRadius: 8, padding: '10px' }}>
              <p style={{ margin: '0 0 2px', fontSize: 16, fontWeight: 800, color: s.c }}>{s.v}</p>
              <p style={{ margin: 0, fontSize: 9, color: '#64748b' }}>{s.l}</p>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 40 }}>
          {[60, 75, 55, 88, 70, 92, 85].map((h, i) => (
            <div key={i} style={{ flex: 1, background: i === 5 ? '#25D366' : '#bbf7d0', borderRadius: 3, height: `${h}%` }} />
          ))}
        </div>
      </div>
    ),
  },
  {
    title: 'Team Management',
    desc: 'Invite agents, create teams, and set roles with permissions. See who\'s online and what they\'re handling in real time.',
    mockup: (
      <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0', padding: 14 }}>
        <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 700, color: '#374151' }}>Invite Team Members</p>
        <div style={{ marginBottom: 10 }}>
          <p style={{ margin: '0 0 4px', fontSize: 9, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>Member Email</p>
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 10px', fontSize: 10, color: '#94a3b8' }}>Enter member's email address</div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <p style={{ margin: '0 0 4px', fontSize: 9, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>Role</p>
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 10px', fontSize: 10, color: '#374151', display: 'flex', justifyContent: 'space-between' }}>Agent <span style={{ color: '#94a3b8' }}>▾</span></div>
        </div>
        {[{ name: 'Alice M.', role: 'Admin', online: true }, { name: 'Bob K.', role: 'Agent', online: true }, { name: 'Carol T.', role: 'Agent', online: false }].map((m) => (
          <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: '1px solid #f1f5f9' }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, color: '#2563eb' }}>{m.name[0]}</div>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: '#111' }}>{m.name}</p>
            </div>
            <span style={{ fontSize: 9, color: '#64748b' }}>{m.role}</span>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: m.online ? '#25D366' : '#cbd5e1' }} />
          </div>
        ))}
      </div>
    ),
  },
];

export default function Channels() {
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  return (
    <section id="features" className="feat_slider_sec">
      <div className="container">
        <div className="text-center sec_title" data-aos="fade-up">
          <span className="sec_badge">Key Features</span>
          <h2>Everything Your Team Needs to Do the Job</h2>
          <p className="text-center" style={{ maxWidth: 560, margin: '0 auto' }}>
            No bloat. No onboarding workshop. Just the tools that make customer conversations actually work.
          </p>
        </div>
      </div>

      <div style={{ position: 'relative', marginTop: 48 }} data-aos="fade-up" data-aos-delay="100">
        <button ref={prevRef} className="feat_nav feat_nav_prev" aria-label="Previous">‹</button>
        <button ref={nextRef} className="feat_nav feat_nav_next" aria-label="Next">›</button>

        <Swiper
          modules={[Navigation, Autoplay]}
          navigation={{ prevEl: prevRef.current, nextEl: nextRef.current }}
          onSwiper={(swiper: SwiperType) => {
            setTimeout(() => {
              if (!swiper?.params?.navigation || typeof swiper.params.navigation === 'boolean') return;
              swiper.params.navigation.prevEl = prevRef.current;
              swiper.params.navigation.nextEl = nextRef.current;
              swiper.navigation?.init();
              swiper.navigation?.update();
            });
          }}
          autoplay={{ delay: 3500, disableOnInteraction: false, pauseOnMouseEnter: true }}
          loop
          spaceBetween={24}
          breakpoints={{
            0:    { slidesPerView: 1 },
            640:  { slidesPerView: 2 },
            1024: { slidesPerView: 3 },
          }}
          style={{ paddingLeft: '60px', paddingRight: '60px' }}
        >
          {SLIDES.map((slide) => (
            <SwiperSlide key={slide.title}>
              <div className="feat_phone_card">
                <h3 className="feat_phone_title">{slide.title}</h3>
                <p className="feat_phone_desc">{slide.desc}</p>
                <div className="feat_phone_screen">{slide.mockup}</div>
              </div>
            </SwiperSlide>
          ))}
        </Swiper>
      </div>
    </section>
  );
}
