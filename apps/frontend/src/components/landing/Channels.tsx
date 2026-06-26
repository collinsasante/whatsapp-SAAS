'use client';
import { useRef } from 'react';
import Image from 'next/image';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Autoplay } from 'swiper/modules';
import type { Swiper as SwiperType } from 'swiper';
import 'swiper/css';

const SLIDES = [
  {
    title: 'Shared Team Inbox',
    desc: 'Every WhatsApp message lands in one shared inbox. Assign to agents, add private notes, and resolve — no "who\'s handling this?"',
    img: '/screenshots/inbox-chat.png',
  },
  {
    title: 'Message Templates',
    desc: 'Create and manage WhatsApp-approved templates for marketing, utility, and authentication — synced and ready to send.',
    img: '/screenshots/message-templates.png',
  },
  {
    title: 'Calls',
    desc: 'Make and take WhatsApp voice calls without leaving the platform, with a full call history for every agent.',
    img: '/screenshots/calls.png',
  },
  {
    title: 'File Library',
    desc: 'Every image, video, and document shared with customers — organized in one searchable library, not buried in chats.',
    img: '/screenshots/file-library.png',
  },
  {
    title: 'Omnichannel Inbox',
    desc: 'Connect WhatsApp, Messenger, Instagram, TikTok, and Telegram, and manage every customer conversation from one dashboard.',
    img: '/screenshots/channel-management.png',
  },
  {
    title: 'Team Management',
    desc: 'Invite agents, assign roles, and see who\'s online and what they\'re handling in real time.',
    img: '/screenshots/team-members.png',
  },
  {
    title: 'Usage & Credits',
    desc: 'Track messages sent, active agents, channels, and AI credit usage live — so there are never any surprises.',
    img: '/screenshots/billing-usage.png',
  },
  {
    title: 'Billing & Plans',
    desc: 'Simple plans that scale with you. Switch plans, view invoices, and manage your subscription anytime.',
    img: '/screenshots/billing-plans.png',
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
          <h2>One Platform for Your Entire Operation</h2>
          <p className="text-center" style={{ maxWidth: 560, margin: '0 auto' }}>
            Inbox, calls, templates, files, channels, your team, and billing — this is the real product, not a mockup.
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
          className="feat_swiper"
        >
          {SLIDES.map((slide) => (
            <SwiperSlide key={slide.title}>
              <div className="feat_phone_card">
                <h3 className="feat_phone_title">{slide.title}</h3>
                <p className="feat_phone_desc">{slide.desc}</p>
                <div className="feat_phone_screen" style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                  <Image
                    src={slide.img}
                    alt={`VerzChat ${slide.title} screen`}
                    width={1710}
                    height={1112}
                    className="w-full h-auto"
                    style={{ display: 'block' }}
                  />
                </div>
              </div>
            </SwiperSlide>
          ))}
        </Swiper>
      </div>
    </section>
  );
}
