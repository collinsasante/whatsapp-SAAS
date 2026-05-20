'use client';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Pagination, Autoplay } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/pagination';

const FEATURES = [
  { emoji: '💬', title: 'Shared Team Inbox', desc: 'Every WhatsApp message lands in one shared inbox. Assign to agents, add private notes, and resolve — no "who\'s handling this?"' },
  { emoji: '📢', title: 'Broadcast Campaigns', desc: 'Send to thousands at once. Upload your list, pick a template, and track delivery, reads, and clicks in real time.' },
  { emoji: '🤖', title: 'Chatbot Automation', desc: 'Build no-code keyword flows. The bot handles FAQs 24/7 and hands off to a live agent the moment it gets stuck.' },
  { emoji: '📊', title: 'Analytics & CSAT', desc: 'Track response times, resolution rates, and customer satisfaction scores. Updated live, not weekly.' },
  { emoji: '🔗', title: 'WhatsApp Business API', desc: 'Official Meta API partner. Full API access, approved templates, and a verified WhatsApp Business profile.' },
  { emoji: '👥', title: 'Team Management', desc: 'Invite agents, create teams, set roles. See who\'s online and what they\'re handling at any moment.' },
  { emoji: '📋', title: 'Message Templates', desc: 'Use Meta-approved message templates for proactive outreach, order updates, reminders, and more.' },
  { emoji: '🧠', title: 'Verz AI Assistant', desc: 'AI-powered reply suggestions trained on your past conversations and knowledge base. Agents reply 3× faster.' },
  { emoji: '📁', title: 'Contact Management', desc: 'Store 20,000+ contacts with custom attributes. Segment by tags, purchase history, or any field you define.' },
  { emoji: '⚡', title: 'Canned Responses', desc: 'Save your best replies as shortcuts. Your team picks the right one in one keystroke — fast, consistent, on-brand.' },
];

export default function Channels() {
  return (
    <section id="features" className="row_am">
      <div className="container">
        <div className="text-center sec_title" data-aos="fade-up">
          <span className="sec_badge">Key Features</span>
          <h2>Everything Your Team Needs to Do the Job</h2>
          <p>No bloat. No onboarding workshop. Just the tools that make customer conversations actually work.</p>
        </div>

        <div data-aos="fade-up" data-aos-delay="100">
          <Swiper
            modules={[Pagination, Autoplay]}
            pagination={{ clickable: true }}
            autoplay={{ delay: 3500, disableOnInteraction: false, pauseOnMouseEnter: true }}
            loop
            spaceBetween={24}
            breakpoints={{
              0:   { slidesPerView: 1 },
              576: { slidesPerView: 2 },
              992: { slidesPerView: 3 },
              1200: { slidesPerView: 4 },
            }}
          >
            {FEATURES.map((f) => (
              <SwiperSlide key={f.title}>
                <div className="feat_card">
                  <div className="fc_icon">{f.emoji}</div>
                  <h3>{f.title}</h3>
                  <p>{f.desc}</p>
                </div>
              </SwiperSlide>
            ))}
          </Swiper>
        </div>
      </div>
    </section>
  );
}
