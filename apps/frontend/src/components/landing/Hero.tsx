'use client';
import { useEffect, useRef } from 'react';
import Image from 'next/image';
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
                See Features
              </a>
            </div>
            <div className="hero_meta">
              <span>No credit card required</span>
              <span>·</span>
              <span>Live in under 20 minutes</span>
              <span>·</span>
              <span>Cancel anytime</span>
            </div>
          </div>

          {/* Right — inline inbox mockup (hidden on mobile, shows at lg+) */}
          <div className="col-lg-6 d-none d-lg-block" data-aos="fade-left" data-aos-delay="150">
            <div className="hero_img_wrap">
              <div className="hero_star_tl">✦</div>
              <div className="hero_star_br">✦</div>
              <div className="hero_mockup">
                <Image
                  src="/screenshots/inbox-chat.png"
                  alt="VerzChat shared inbox showing a live customer conversation"
                  width={1710}
                  height={1112}
                  className="w-full h-auto"
                  style={{ display: 'block' }}
                  priority
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
